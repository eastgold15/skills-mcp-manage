import { managedIds, scanScope } from "./scope";
import { syncFromLock } from "./state";
import type { ScopeEntry, SkillView } from "./types";

/** list 的数据：本体库全景 + 各作用域启用实况 */
export async function buildViews(projectPath: string): Promise<SkillView[]> {
  const state = await syncFromLock();
  const [globalIds, projectIds] = await Promise.all([
    managedIds("global", projectPath),
    managedIds("project", projectPath),
  ]);

  return Object.entries(state.skills)
    .map(([id, skill]) => ({
      enabledGlobal: globalIds.has(id),
      enabledProject: projectIds.has(id),
      id,
      orphaned: skill.orphaned === true,
      updatable: skill.upstream !== null,
    }))
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
