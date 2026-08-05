import { syncFromLock } from "../core/state";
import type { MergeState } from "../core/types";
import { isUpdateError, type UpdateOutcome, updateSkill } from "../core/update";
import { colors } from "../ui/colors";
import { askMultiSelect, printSuccess, printWarning } from "../ui/prompts";
import { withSpinner } from "../ui/spinner";

/** 四象限对用户的说法 */
const QUADRANT_TEXT: Record<number, string> = {
  1: "已是最新",
  2: "已更新到上游最新版",
  3: "上游无变化，保留本地修改",
};

function describe(outcome: UpdateOutcome): string {
  if (outcome.quadrant === 4) {
    return outcome.conflicts.length === 0
      ? "已合并上游改动，本地修改保留"
      : `已合并，但 ${outcome.conflicts.length} 个文件需手动处理`;
  }
  return QUADRANT_TEXT[outcome.quadrant] ?? "完成";
}

/** 有上游、未失联的才能更新 */
function updatableIds(state: MergeState): string[] {
  return Object.entries(state.skills)
    .filter(([, skill]) => skill.upstream !== null && !skill.orphaned)
    .map(([id]) => id);
}

/** 确定要更新哪些：给了 id 就校验，没给就让用户多选 */
async function resolveTargets(
  state: MergeState,
  updatable: string[],
  id?: string
): Promise<string[] | null> {
  if (id) {
    if (updatable.includes(id)) {
      return [id];
    }
    printWarning(
      state.skills[id] ? `${id} 没有上游记录，无法更新` : `本体库中没有 ${id}`
    );
    return null;
  }

  const picked = await askMultiSelect<string>(
    "选择要更新的 skill（空格多选）",
    updatable.map((key) => ({ label: key, value: key }))
  );
  if (picked.length === 0) {
    printWarning("未选择任何 skill");
    return null;
  }
  return picked;
}

interface Conflicted {
  files: string[];
  id: string;
}

/** 逐个更新并即时汇报。必须顺序执行，spinner 与输出才不错乱 */
async function runUpdates(
  targets: string[],
  state: MergeState
): Promise<Conflicted[]> {
  const conflicted: Conflicted[] = [];

  for (const target of targets) {
    const result = await withSpinner(`正在更新 ${target}`, () =>
      updateSkill(target, state)
    );

    if (isUpdateError(result)) {
      printWarning(
        result.kind === "no-upstream"
          ? `${target}：无上游记录`
          : `${target}：本体库中不存在`
      );
      continue;
    }

    console.log(`  ${colors.bold(target)}  ${describe(result)}`);

    if (result.baseInitialized) {
      console.log(
        colors.gray(
          "    首次接管，已用当前内容建立基线；下次更新起可完整识别本地修改"
        )
      );
    }
    if (result.conflicts.length > 0) {
      conflicted.push({ files: result.conflicts, id: target });
    }
  }

  return conflicted;
}

function reportConflicts(conflicted: Conflicted[]): void {
  console.log("");
  printWarning("以下文件存在冲突，已写入冲突标记，请手动处理：");
  for (const { id, files } of conflicted) {
    for (const file of files) {
      console.log(colors.warning(`  ${id}/${file}`));
    }
  }
  console.log(
    colors.gray("  搜索 <<<<<<< 定位冲突处，保留需要的内容后删除标记行")
  );
}

/**
 * 更新只动本体库，不涉及任何作用域 ——
 * 全链接架构下作用域侧是链接，内容自动跟随，所以不需要 projectPath。
 */
export async function update(id?: string): Promise<void> {
  const state = await syncFromLock();
  const updatable = updatableIds(state);

  if (updatable.length === 0) {
    printWarning("没有可更新的 skill（需要 skills.sh 记录了上游地址）");
    return;
  }

  const targets = await resolveTargets(state, updatable, id);
  if (!targets) {
    return;
  }

  const conflicted = await runUpdates(targets, state);

  if (conflicted.length === 0) {
    printSuccess("更新完成");
    return;
  }
  reportConflicts(conflicted);
}
