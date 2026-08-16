import { isAccessible, remove } from "@visulima/fs";
import { baseDir, scopeLink, skillDir } from "./paths";
import { skillsRemove } from "./registry";
import { checkpoint, isRepo } from "./repo";
import { disableSkill } from "./scope";
import { syncFromLock, writeState } from "./state";
import type { MergeState, Scope } from "./types";

/**
 * 一个 skill 被删除时牵涉到的东西。
 *
 * 全链接架构下删本体不会自动清作用域 —— 实测删掉 ~/.agents/skills/<id>
 * 后，指向它的 junction 仍然存在，只是变成悬空链接（lstat 能读到、
 * readlink 还指向原处，但内容 ENOENT）。Claude Code 扫到会出错，
 * 所以必须先摘链接再删本体。
 */
export interface RemovalPlan {
  /** 有 base 快照要一起清 */
  hasBase: boolean;
  /** 本体库里存在 */
  hasBody: boolean;
  id: string;
  /** lock 里有记录 —— 需要 skills.sh 同步删除，否则它还以为装着 */
  inLock: boolean;
  /** 在哪些作用域被链接了，删本体前要先摘掉 */
  linkedScopes: Scope[];
}

/** 查清删除一个 skill 要动哪些地方 */
export async function planRemoval(
  id: string,
  projectPath: string,
  state: MergeState
): Promise<RemovalPlan> {
  const entry = state.skills[id];
  const linked: Scope[] = [];

  for (const scope of ["global", "project"] as const) {
    const link = scopeLink(scope, projectPath, id);
    if (await isAccessible(link)) {
      linked.push(scope);
    }
  }

  return {
    hasBase: await isAccessible(baseDir(id)),
    hasBody: await isAccessible(skillDir(id)),
    id,
    inLock: Boolean(entry?.upstream?.lockFolderHash),
    linkedScopes: linked,
  };
}

export type RemoveOutcome =
  /** 删完了 */
  | "removed"
  /** 本体库里本来就没有 */
  | "missing"
  /** 作用域链接摘不掉，为免留下悬空链接而中止 */
  | "blocked";

export interface RemoveResult {
  id: string;
  outcome: RemoveOutcome;
  reason?: string;
  /** 实际摘掉的作用域链接 */
  unlinked: Scope[];
}

/**
 * 删除单个 skill。
 *
 * 顺序有讲究：先摘作用域链接，再删本体与 base，最后清 state 条目。
 * 反过来会留下悬空链接。
 */
export async function removeSkill(
  id: string,
  projectPath: string,
  state: MergeState
): Promise<RemoveResult> {
  const plan = await planRemoval(id, projectPath, state);

  if (!plan.hasBody) {
    // 本体没了但 state 里还有记录：清掉记录即可
    delete state.skills[id];
    return { id, outcome: "missing", unlinked: [] };
  }

  const unlinked: Scope[] = [];
  for (const scope of plan.linkedScopes) {
    const outcome = await disableSkill(scope, projectPath, id);
    if (outcome === "disabled") {
      unlinked.push(scope);
      continue;
    }
    if (outcome === "not-managed") {
      // 不是我们建的链接，不碰；但删本体会让它变悬空，故中止
      return {
        id,
        outcome: "blocked",
        reason: `${scope === "global" ? "全局" : "项目"}下的链接非本工具建立，删本体会让它悬空`,
        unlinked,
      };
    }
  }

  await remove(skillDir(id));
  if (plan.hasBase) {
    await remove(baseDir(id));
  }
  delete state.skills[id];

  return { id, outcome: "removed", unlinked };
}

export interface BatchRemoveResult {
  /** 需要 skills.sh 同步删除的 id */
  needsSync: string[];
  results: RemoveResult[];
}

/**
 * 批量删除。
 *
 * 先落一个 git 检查点 —— 删除是不可逆操作，有检查点就能 git revert 找回。
 */
export async function removeSkills(
  ids: string[],
  projectPath: string
): Promise<BatchRemoveResult> {
  const state = await syncFromLock();

  if (await isRepo()) {
    await checkpoint(`chore: 删除 ${ids.length} 个 skill 前的检查点`);
  }

  const results: RemoveResult[] = [];
  const needsSync: string[] = [];

  for (const id of ids) {
    // 记在删除前 —— 删完 state 条目就没了
    const inLock = Boolean(state.skills[id]?.upstream?.lockFolderHash);
    const result = await removeSkill(id, projectPath, state);
    results.push(result);
    if (result.outcome === "removed" && inLock) {
      needsSync.push(id);
    }
  }

  await writeState(state);
  return { needsSync, results };
}

/**
 * 让 skills.sh 也把这些 skill 从账上去掉。
 *
 * 不同步的后果：npx skills list 仍列出已删的 skill，
 * 而且 .skill-lock.json 里的记录会在下次 syncFromLock 时
 * 被我们重新投影回 state，显示成 orphaned。
 */
export async function syncRemovalToSkillsSh(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await skillsRemove(ids);
}
