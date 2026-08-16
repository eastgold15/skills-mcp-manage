import { managedIds, scanScope } from "./scope";
import { syncFromLock } from "./state";
import type { ScopeEntry, SkillState, SkillView, SyncStatus } from "./types";

/**
 * 推导同步状态。
 *
 * 两个信息来源，取更近的那个：
 *  - lastCheck  联网对比的结论（agent check）
 *  - lastMerge  上次 update 的四象限判定
 *
 * update 之后状态是确定的（刚同步过），check 只是观测，
 * 所以同一时刻优先信 lastMerge。
 */
export function deriveStatus(skill: SkillState): SyncStatus {
  if (!skill.upstream) {
    return "no-upstream";
  }

  const { lastCheck, lastMerge } = skill;

  // 上次合并留了冲突，优先报出 —— 那是需要人处理的。
  // 除非之后又 check 过（冲突可能已被手工解决），以更近的观测为准。
  if (
    lastMerge &&
    lastMerge.conflicts.length > 0 &&
    !(lastCheck && lastCheck.at > lastMerge.at)
  ) {
    return "conflicted";
  }

  const checkNewer = lastCheck && (!lastMerge || lastCheck.at >= lastMerge.at);

  if (checkNewer) {
    if (lastCheck.upstreamChanged) {
      return lastCheck.localChanged ? "diverged" : "behind";
    }
    return lastCheck.localChanged ? "local-only" : "up-to-date";
  }

  if (lastMerge) {
    // 刚 update 完：象限 3 说明本地有改动且上游没动；
    // 其余象限都已把上游内容取下来了，此刻即最新
    return lastMerge.quadrant === 3 ? "local-only" : "up-to-date";
  }

  return "unknown";
}

/** 状态的新鲜度时刻，取两个观测里更近的 */
function statusTime(skill: SkillState): string | undefined {
  const { lastCheck, lastMerge } = skill;
  if (!lastCheck) {
    return lastMerge?.at;
  }
  if (!lastMerge) {
    return lastCheck.at;
  }
  return lastCheck.at > lastMerge.at ? lastCheck.at : lastMerge.at;
}

/** list 的数据：本体库全景 + 各作用域启用实况 */
export async function buildViews(projectPath: string): Promise<SkillView[]> {
  const state = await syncFromLock();
  const [globalIds, projectIds] = await Promise.all([
    managedIds("global", projectPath),
    managedIds("project", projectPath),
  ]);

  return Object.entries(state.skills)
    .map(([id, skill]) => {
      const at = statusTime(skill);
      return {
        conflicts: skill.lastMerge?.conflicts.length ?? 0,
        enabledGlobal: globalIds.has(id),
        enabledProject: projectIds.has(id),
        id,
        orphaned: skill.orphaned === true,
        status: deriveStatus(skill),
        tracked: skill.upstream !== null,
        ...(at ? { checkedAt: at } : {}),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface Diagnosis {
  counts: { managed: number; external: number; directory: number };
  entries: ScopeEntry[];
  scope: "global" | "project";
}

/** doctor 的数据：把作用域目录里的三种形态摊开 */
export async function diagnose(projectPath: string): Promise<Diagnosis[]> {
  const result: Diagnosis[] = [];

  for (const scope of ["global", "project"] as const) {
    const entries = await scanScope(scope, projectPath);
    result.push({
      counts: {
        directory: entries.filter((e) => e.kind === "directory").length,
        external: entries.filter((e) => e.kind === "external").length,
        managed: entries.filter((e) => e.kind === "managed").length,
      },
      entries,
      scope,
    });
  }

  return result;
}
