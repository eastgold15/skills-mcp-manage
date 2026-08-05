import { isAccessible, remove } from "@visulima/fs";
import { join } from "@visulima/path";
import { calculateDirectoryHash } from "../utils/hash";
import { decideQuadrant, mapDirectory } from "./diff";
import { fetchUpstream } from "./fetch";
import { mergeDirectories, snapshotBase } from "./merge";
import { agentsRoot, baseDir, skillDir } from "./paths";
import { syncFromLock, writeState } from "./state";
import type { MergeState, Quadrant } from "./types";

export interface UpdateOutcome {
  /** base 快照缺失，本次用当前内容初始化，判不出本地改动 */
  baseInitialized: boolean;
  /** 留下冲突标记、需人工处理的文件 */
  conflicts: string[];
  id: string;
  quadrant: Quadrant;
}

export type UpdateError =
  /** state 里没有这个 skill */
  | { kind: "unknown"; id: string }
  /** lock 未记录，无上游可拉 */
  | { kind: "no-upstream"; id: string };

/** 临时工作区，用后即删 */
function workDir(id: string): string {
  return join(agentsRoot(), ".work", id);
}

/**
 * 更新单个 skill：四象限判定 + 必要时三路合并。
 *
 * 只动本体库。全链接架构下作用域侧是链接，自动跟随。
 */
export async function updateSkill(
  id: string,
  state?: MergeState
): Promise<UpdateOutcome | UpdateError> {
  const current = state ?? (await syncFromLock());
  const entry = current.skills[id];

  if (!entry) {
    return { id, kind: "unknown" };
  }
  if (!entry.upstream) {
    return { id, kind: "no-upstream" };
  }

  const ours = skillDir(id);
  const base = baseDir(id);
  const work = workDir(id);

  try {
    const { contentDir: theirs, commit } = await fetchUpstream(
      entry.upstream.sourceUrl,
      entry.upstream.skillPath,
      work
    );

    // base 快照缺失（首次接管已装的 skill）：
    // 用当前内容初始化，视为「当前即上次同步态」。
    // 代价是本次判不出本地改动，只能走象限 1/2，第二次起完整可用。
    const baseInitialized = !(await isAccessible(base));
    if (baseInitialized) {
      await snapshotBase(ours, base);
    }

    const maps = {
      base: await mapDirectory(base),
      ours: await mapDirectory(ours),
      theirs: await mapDirectory(theirs),
    };
    const verdict = decideQuadrant(maps.base, maps.ours, maps.theirs);
    let conflicts: string[] = [];

    switch (verdict.quadrant) {
      case 1:
      case 3:
        // 上游没变，什么都不做
        break;
      case 2:
      case 4: {
        // 象限2 逐文件也会全判为 take-theirs，与象限4 共用同一条路径
        const result = await mergeDirectories(maps, {
          base,
          ours,
          theirs,
        });
        conflicts = result.conflicted;
        break;
      }
      default:
        break;
    }

    // 上游有变且无残留冲突时推进 base 快照
    if (verdict.upstreamChanged && conflicts.length === 0) {
      await snapshotBase(theirs, base);
    }

    const now = new Date().toISOString();
    current.skills[id] = {
      ...entry,
      base: {
        contentHash: await calculateDirectoryHash(base),
        syncedAt: now,
        ...(commit ? { upstreamCommit: commit } : {}),
      },
      lastMerge: { at: now, conflicts, quadrant: verdict.quadrant },
    };
    await writeState(current);

    return { baseInitialized, conflicts, id, quadrant: verdict.quadrant };
  } finally {
    await remove(work);
  }
}

export function isUpdateError(
  value: UpdateOutcome | UpdateError
): value is UpdateError {
  return "kind" in value;
}
