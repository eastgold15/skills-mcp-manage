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
 * 单向同步：.skill-lock.json + 本体库目录实况 → .merge-state.json
 *
 * 方向恒定（我们的改动永不回写 lock），因此不存在双真理源冲突。
 * 投影只覆盖 upstream 段；base 与 lastMerge 段原样保留。
 *
 * 门控同时看两个输入：lock 的文件哈希 **与** 本体库的目录清单。
 * 只看 lock 会漏掉「直接删掉 ~/.agents/skills/<id> 目录」这条路径 ——
 * 那些无上游的 skill 压根不在 lock 里，删掉后 lock 一字节未变，
 * 门控短路导致陈旧条目永久留存，list 会显示已不存在的 skill。
 */
export async function syncFromLock(): Promise<MergeState> {
  const state = await readState();
  const lockPath = lockFile();

  const currentHash = (await isAccessible(lockPath))
    ? await calculateFileHash(lockPath)
    : "";
  const libraryIds = await scanLibrary();
  const currentLibrary = libraryIds.join(",");

  // 门控：lock 与本体库目录都没变才可以复用现有 state
  if (
    currentHash !== "" &&
    currentHash === state.lockFileHash &&
    currentLibrary === (state.libraryIds ?? []).join(",")
  ) {
    return state;
  }

  const lock = await readLock();
  const lockSkills = lock?.skills ?? {};
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
    libraryIds,
    lockFileHash: currentHash,
    skills: next,
    syncedFromLockAt: new Date().toISOString(),
    version: STATE_VERSION,
  };

  await writeState(synced);
  return synced;
}
