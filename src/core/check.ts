import { isAccessible, remove } from "@visulima/fs";
import { join } from "@visulima/path";
import { decideQuadrant, mapDirectory } from "./diff";
import { fetchUpstream, UpstreamPathError } from "./fetch";
import { agentsRoot, baseDir, skillDir } from "./paths";
import { syncFromLock, writeState } from "./state";
import type { CheckRecord, MergeState } from "./types";

export interface CheckOutcome {
  /** 拉到的上游 commit */
  commit?: string;
  id: string;
  localChanged: boolean;
  /** 没有 base 快照，判不出本地是否改过 */
  noBaseline: boolean;
  upstreamChanged: boolean;
}

export type CheckError =
  | { id: string; kind: "unknown" }
  | { id: string; kind: "no-upstream" }
  | { id: string; kind: "failed"; reason: string };

/** 临时工作区，用后即删 */
function workDir(id: string): string {
  return join(agentsRoot(), ".check", id);
}

/**
 * 检查单个 skill 的上游状态。
 *
 * 与 update 的区别：**只看不动**。拉上游、比四象限、把结论写进 state，
 * 本体库一个字节都不碰。这样 ls 才能回答「有没有新版本」——
 * 那个问题本地无从推导，lockFolderHash 是安装时算的，不随上游变化。
 */
export async function checkSkill(
  id: string,
  state?: MergeState
): Promise<CheckOutcome | CheckError> {
  const current = state ?? (await syncFromLock());
  const entry = current.skills[id];

  if (!entry) {
    return { id, kind: "unknown" };
  }
  if (!entry.upstream) {
    return { id, kind: "no-upstream" };
  }

  const work = workDir(id);

  try {
    const { contentDir: theirs, commit } = await fetchUpstream(
      entry.upstream.sourceUrl,
      entry.upstream.skillPath,
      work
    );

    const base = baseDir(id);
    const noBaseline = !(await isAccessible(base));

    const maps = {
      base: await mapDirectory(base),
      ours: await mapDirectory(skillDir(id)),
      theirs: await mapDirectory(theirs),
    };

    // 与 update 同一道防线：上游空、本地非空必然是拉取出了问题
    if (maps.theirs.size === 0 && maps.ours.size > 0) {
      return {
        id,
        kind: "failed",
        reason: "上游没拉到任何文件，无法判断",
      };
    }

    // 没有 base 时拿本体库当参照：此时判不出本地改动，
    // 但「上游与本体库不同」仍是有用的信号
    const reference = noBaseline ? maps.ours : maps.base;
    const verdict = decideQuadrant(reference, maps.ours, maps.theirs);

    const record: CheckRecord = {
      at: new Date().toISOString(),
      localChanged: noBaseline ? false : verdict.localChanged,
      upstreamChanged: verdict.upstreamChanged,
      ...(commit ? { commit } : {}),
    };

    current.skills[id] = { ...entry, lastCheck: record };
    await writeState(current);

    return {
      id,
      localChanged: record.localChanged,
      noBaseline,
      upstreamChanged: record.upstreamChanged,
      ...(commit ? { commit } : {}),
    };
  } catch (error) {
    if (error instanceof UpstreamPathError) {
      return { id, kind: "failed", reason: error.message };
    }
    return {
      id,
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await remove(work);
  }
}

export function isCheckError(
  value: CheckOutcome | CheckError
): value is CheckError {
  return "kind" in value;
}
