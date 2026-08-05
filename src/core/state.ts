import {
  ensureDir,
  isAccessible,
  readJson,
  walk,
  writeJson,
} from "@visulima/fs";
import { join } from "@visulima/path";
import { calculateFileHash } from "../utils/hash";
import { agentsRoot, libraryDir, lockFile, stateFile } from "./paths";
import type { MergeState, SkillLock, SkillState } from "./types";

const STATE_VERSION = 1;

function emptyState(): MergeState {
  return {
    lockFileHash: "",
    skills: {},
    syncedFromLockAt: "",
    version: STATE_VERSION,
  };
}

async function readState(): Promise<MergeState> {
  const path = stateFile();
  if (!(await isAccessible(path))) {
    return emptyState();
  }
  const raw = await readJson<MergeState>(path);
  // 版本不符时丢弃重建：我们的数据可从 lock 与文件系统重新推导
  if (raw.version !== STATE_VERSION) {
    return emptyState();
  }
  return raw;
}

export async function writeState(state: MergeState): Promise<void> {
  // 目录可能尚不存在（skills.sh 从未装过，或刚被清理）
  await ensureDir(agentsRoot());
  await writeJson(stateFile(), state, { indent: 2 });
}

async function readLock(): Promise<SkillLock | null> {
  const path = lockFile();
  if (!(await isAccessible(path))) {
    return null;
  }
  return await readJson<SkillLock>(path);
}

/** 扫本体库，列出所有含 SKILL.md 的目录 */
async function scanLibrary(): Promise<string[]> {
  const root = libraryDir();
  if (!(await isAccessible(root))) {
    return [];
  }

  const ids: string[] = [];
  for await (const entry of walk(root, { includeFiles: false, maxDepth: 1 })) {
    if (entry.path === root) {
      continue;
    }
    if (
      entry.isDirectory() &&
      (await isAccessible(join(entry.path, "SKILL.md")))
    ) {
      ids.push(entry.name);
    }
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

/**
 * 单向同步：.skill-lock.json → .merge-state.json
 *
 * 方向恒定（我们的改动永不回写 lock），因此不存在双真理源冲突。
 * 靠 lock 的文件哈希门控：一致则整个投影跳过，零成本。
 *
 * 投影只覆盖 upstream 段；base 与 lastMerge 段原样保留。
 */
export async function syncFromLock(): Promise<MergeState> {
  const state = await readState();
  const lockPath = lockFile();

  const currentHash = (await isAccessible(lockPath))
    ? await calculateFileHash(lockPath)
    : "";

  // 门控：lock 没变则直接用现有 state
  if (currentHash !== "" && currentHash === state.lockFileHash) {
    return state;
  }

  const lock = await readLock();
  const lockSkills = lock?.skills ?? {};
  const libraryIds = await scanLibrary();
  const next: Record<string, SkillState> = {};

  // ① 吸取 lock 记录的条目：覆盖 upstream 段，保留我们的段
  for (const [id, entry] of Object.entries(lockSkills)) {
    const prev = state.skills[id];
    next[id] = {
      base: prev?.base ?? null,
      upstream: {
        lockFolderHash: entry.skillFolderHash,
        skillPath: entry.skillPath,
        sourceUrl: entry.sourceUrl,
      },
      ...(prev?.lastMerge ? { lastMerge: prev.lastMerge } : {}),
    };
  }

  // ② 补全本体库里存在但 lock 未记录的：可启用，不可更新
  for (const id of libraryIds) {
    if (next[id]) {
      continue;
    }
    const prev = state.skills[id];
    next[id] = {
      base: prev?.base ?? null,
      upstream: null,
      ...(prev?.lastMerge ? { lastMerge: prev.lastMerge } : {}),
    };
  }

  // ③ 曾记录过、现在 lock 与本体库都没有的：标 orphaned 而非删除，
  //    以免丢掉 base 快照与合并历史
  for (const [id, prev] of Object.entries(state.skills)) {
    if (next[id]) {
      continue;
    }
    next[id] = { ...prev, orphaned: true };
  }

  const synced: MergeState = {
    lockFileHash: currentHash,
    skills: next,
    syncedFromLockAt: new Date().toISOString(),
    version: STATE_VERSION,
  };

  await writeState(synced);
  return synced;
}
