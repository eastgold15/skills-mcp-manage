import {
  planRemoval,
  type RemoveResult,
  removeSkills,
  syncRemovalToSkillsSh,
} from "../core/removal";
import { isRepo } from "../core/repo";
import { syncFromLock } from "../core/state";
import type { MergeState } from "../core/types";
import { buildViews } from "../core/view";
import { colors } from "../ui/colors";
import {
  askConfirm,
  askMultiSelect,
  PromptCancelled,
  printSuccess,
  printTable,
  printWarning,
} from "../ui/prompts";
import { withSpinner } from "../ui/spinner";

export interface RemoveOptions {
  /** 跳过确认 */
  force?: boolean;
  /** 要删的 id，省略则进入多选 */
  ids?: string[];
  /** 不通知 skills.sh */
  noSync?: boolean;
}

/** 让用户从本体库里挑要删的 */
async function pickTargets(projectPath: string): Promise<string[]> {
  const views = (await buildViews(projectPath)).filter((v) => !v.orphaned);

  if (views.length === 0) {
    printWarning("本体库为空");
    return [];
  }

  const enabledHint = (v: (typeof views)[number]): string | undefined => {
    const scopes: string[] = [];
    if (v.enabledGlobal) {
      scopes.push("全局");
    }
    if (v.enabledProject) {
      scopes.push("项目");
    }
    return scopes.length > 0 ? `已启用于${scopes.join("、")}` : undefined;
  };

  return await askMultiSelect<string>(
    "选择要从本体库删除的 skill（空格多选）",
    views.map((v) => {
      const hint = enabledHint(v);
      return { label: v.id, value: v.id, ...(hint ? { hint } : {}) };
    })
  );
}

/** 删除前把要动的东西摆出来 */
async function preview(
  ids: string[],
  projectPath: string,
  state: MergeState
): Promise<number> {
  const rows: string[][] = [];
  let willRemove = 0;

  for (const id of ids) {
    const plan = await planRemoval(id, projectPath, state);
    if (!plan.hasBody) {
      rows.push([
        colors.gray(id),
        colors.gray("本体库中不存在"),
        colors.gray("只清记录"),
      ]);
      continue;
    }

    willRemove += 1;
    const effects: string[] = ["删除本体"];
    if (plan.linkedScopes.length > 0) {
      effects.push(
        `摘除${plan.linkedScopes
          .map((s) => (s === "global" ? "全局" : "项目"))
          .join("、")}链接`
      );
    }
    if (plan.hasBase) {
      effects.push("清 base 快照");
    }
    if (plan.inLock) {
      effects.push(colors.warning("需同步 skills.sh"));
    }

    rows.push([id, colors.warning("将删除"), colors.gray(effects.join(" + "))]);
  }

  printTable(["ID", "动作", "影响"], rows);
  return willRemove;
}

/** 收集目标，取消或空则返回 null */
async function gatherTargets(
  projectPath: string,
  options: RemoveOptions,
  state: MergeState
): Promise<string[] | null> {
  let picked: string[];
  try {
    picked = options.ids?.length ? options.ids : await pickTargets(projectPath);
  } catch (error) {
    // 多选被取消：删除还没开始，直接收场
    if (error instanceof PromptCancelled) {
      printWarning("已取消，未删除任何东西");
      return null;
    }
    throw error;
  }

  const valid = picked.filter((id) => {
    if (state.skills[id]) {
      return true;
    }
    printWarning(`${id}：本体库中没有这个 skill，跳过`);
    return false;
  });

  if (valid.length === 0) {
    printWarning("没有要删除的 skill");
    return null;
  }
  return valid;
}

/** 删除是不可逆的，确认前先说清有没有 git 兜底 */
async function confirmRemoval(count: number): Promise<boolean> {
  const guarded = await isRepo();
  console.log(
    guarded
      ? colors.gray(
          "本体库在 git 管理下，删除前会自动建检查点，可 git revert 找回"
        )
      : colors.warning(
          "本体库还没纳入 git 管理，删除不可恢复。建议先跑 agent repo"
        )
  );

  try {
    const ok = await askConfirm(`确认删除这 ${count} 个 skill？`);
    if (!ok) {
      printWarning("已取消，未删除任何东西");
    }
    return ok;
  } catch (error) {
    if (error instanceof PromptCancelled) {
      printWarning("已取消，未删除任何东西");
      return false;
    }
    throw error;
  }
}

/** 汇报删除结果 */
function reportResults(results: RemoveResult[]): void {
  const removed = results.filter((r) => r.outcome === "removed");
  const blocked = results.filter((r) => r.outcome === "blocked");
  const missing = results.filter((r) => r.outcome === "missing");

  for (const r of blocked) {
    printWarning(`${r.id}：${r.reason ?? "被阻止"}`);
  }
  if (missing.length > 0) {
    console.log(
      colors.gray(`${missing.length} 个本体库中已不存在，只清掉了记录`)
    );
  }
  if (removed.length > 0) {
    const unlinked = removed.reduce((sum, r) => sum + r.unlinked.length, 0);
    printSuccess(
      unlinked > 0
        ? `已删除 ${removed.length} 个 skill，同时摘掉 ${unlinked} 处作用域链接`
        : `已删除 ${removed.length} 个 skill`
    );
  }
}

/** 把删除同步到 skills.sh，失败则给出手动命令 */
async function syncToSkillsSh(
  needsSync: string[],
  noSync: boolean
): Promise<void> {
  if (needsSync.length === 0) {
    return;
  }

  const manual = `npx skills remove ${needsSync.join(" ")} -g -y`;

  if (noSync) {
    console.log(
      colors.gray(
        `${needsSync.length} 个在 skills.sh 账上仍有记录。` +
          `跑 ${manual} 清掉，否则下次 ls 会显示为已失联`
      )
    );
    return;
  }

  try {
    await withSpinner("正在同步到 skills.sh", () =>
      syncRemovalToSkillsSh(needsSync)
    );
    printSuccess(`已从 skills.sh 账上去掉 ${needsSync.length} 个`);
  } catch (error) {
    printWarning(
      `skills.sh 同步失败：${error instanceof Error ? error.message : String(error)}`
    );
    console.log(colors.gray(`可手动执行：${manual}`));
  }
}

/**
 * 从本体库批量删除 skill。
 *
 * 顺序：摘作用域链接 → 删本体与 base → 清 state → 通知 skills.sh。
 * 先摘链接是必须的 —— 实测删掉本体后 junction 仍存在但变成悬空链接
 * （lstat 能读到、内容 ENOENT），Claude Code 扫到会出错。
 */
export async function remove(
  projectPath: string,
  options: RemoveOptions = {}
): Promise<void> {
  const state = await syncFromLock();

  const targets = await gatherTargets(projectPath, options, state);
  if (!targets) {
    return;
  }

  const willRemove = await preview(targets, projectPath, state);

  if (!(options.force || (await confirmRemoval(willRemove)))) {
    return;
  }

  const { needsSync, results } = await withSpinner("正在删除", () =>
    removeSkills(targets, projectPath)
  );

  reportResults(results);
  await syncToSkillsSh(needsSync, Boolean(options.noSync));
}
