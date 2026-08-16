import { findCandidates } from "../core/registry";
import { checkpoint, initRepo, isRepo } from "../core/repo";
import { syncFromLock } from "../core/state";
import {
  type Comparison,
  compareAll,
  describeComparison,
  handoffToSkillsSh,
  recordUpstream,
  type Verdict,
} from "../core/track";
import type { MergeState } from "../core/types";
import { colors } from "../ui/colors";
import {
  askSelect,
  PromptCancelled,
  printSuccess,
  printWarning,
} from "../ui/prompts";
import { withSpinner } from "../ui/spinner";

export interface TrackOptions {
  /** 逐字节一致的直接采用，不逐个问 */
  autoIdentical?: boolean;
  /** 记上游后同时调 skills add 让 skills.sh 也入账 */
  handoff?: boolean;
  /** 只处理这些 id，省略则处理全部无上游的 */
  ids?: string[];
  /** 只列出候选，不入账 */
  listOnly?: boolean;
}

/** 判定的可读说法与着色 */
const VERDICT_TEXT: Record<
  Verdict,
  { label: string; paint: (t: string) => string }
> = {
  identical: { label: "逐字节一致", paint: colors.success },
  likely: { label: "很可能同源", paint: colors.info },
  unreachable: { label: "拉取失败", paint: colors.gray },
  unrelated: { label: "大概无关", paint: colors.gray },
  unsure: { label: "不确定", paint: colors.warning },
};

function show(comparison: Comparison, index: number, total: number): void {
  const { label, paint } = VERDICT_TEXT[comparison.verdict];
  console.log(
    `  ${colors.gray(`[${index}/${total}]`)} ${comparison.candidate.pkg}` +
      `  ${colors.gray(`${comparison.candidate.installs} installs`)}`
  );
  console.log(
    `      ${paint(label)}  ${colors.gray(describeComparison(comparison))}`
  );
}

type Decision = Comparison | "skip";

/** 让用户在候选里挑，或跳过 */
async function ask(comparisons: Comparison[]): Promise<Decision> {
  const usable = comparisons.filter(
    (c) => c.verdict !== "unreachable" && c.verdict !== "unrelated"
  );

  if (usable.length === 0) {
    printWarning("      没有可用候选");
    return "skip";
  }

  const options = usable.map((c) => ({
    hint: describeComparison(c),
    label: `${c.candidate.pkg}（${VERDICT_TEXT[c.verdict].label}）`,
    value: c as Decision,
  }));
  options.push({
    hint: "留着以后再说",
    label: "跳过这个 skill",
    value: "skip" as Decision,
  });

  return await askSelect<Decision>("      记哪个为上游？", options);
}

/** 处理一个 skill，返回是否记下了上游 */
async function handleOne(
  id: string,
  index: number,
  total: number,
  state: MergeState,
  options: TrackOptions
): Promise<boolean> {
  console.log("");
  console.log(colors.info(`[${index}/${total}] ${id}`));

  const candidates = await withSpinner(`正在搜索 ${id} 的上游`, () =>
    findCandidates(id)
  );
  if (candidates.length === 0) {
    printWarning("      skills.sh 上没有同名 skill");
    return false;
  }

  const comparisons = await withSpinner(
    `正在拉取 ${Math.min(candidates.length, 3)} 个候选对比内容`,
    () => compareAll(id, candidates)
  );
  for (const [i, comparison] of comparisons.entries()) {
    show(comparison, i + 1, comparisons.length);
  }

  if (options.listOnly) {
    return false;
  }

  // 逐字节一致就是确定答案，可以不问
  const exact = comparisons.find((c) => c.verdict === "identical");
  const chosen =
    options.autoIdentical && exact ? exact : await ask(comparisons);

  if (chosen === "skip") {
    return false;
  }

  await recordUpstream(id, chosen, state);
  printSuccess(`      已记为上游：${chosen.candidate.pkg}`);

  if (options.handoff) {
    // skills add 会用上游内容覆盖本体库里已有的那份，
    // 所以前面必须已经建好 git 检查点
    await withSpinner(`正在让 skills.sh 接管 ${id}`, () =>
      handoffToSkillsSh(chosen)
    );
    printSuccess("      skills.sh 已入账，npx skills list 可见");
  }

  return true;
}

/**
 * 确保本体库在 git 管理下。
 *
 * 这是安全网：后面 skills add 会用上游内容覆盖本体库，
 * 没有版本管理就是不可恢复的丢数据。
 */
async function ensureSafetyNet(): Promise<void> {
  if (await isRepo()) {
    const sha = await checkpoint("chore: track 前的检查点");
    if (sha) {
      printSuccess(`已提交检查点 ${sha.slice(0, 7)}，本次改动可回退`);
    }
    return;
  }

  const created = await initRepo();
  if (created) {
    printSuccess(
      `已把本体库纳入 git 管理（${created.commit.slice(0, 7)}），改动可回退`
    );
  }
}

/** 确定要处理哪些 skill */
function resolveTargets(state: MergeState, ids?: string[]): string[] {
  if (ids?.length) {
    return ids.filter((id) => state.skills[id]);
  }
  return Object.entries(state.skills)
    .filter(([, skill]) => !(skill.upstream || skill.orphaned))
    .map(([id]) => id);
}

/**
 * 为无上游的 skill 找到并记录上游。
 *
 * 为什么要搜：本地 skill 的 frontmatter 只有 name/description，没有来源
 * 字段；那些项目里也没有 .skill-lock.json（不是 skills.sh 装的）。
 * 所以只能按名字去 skills.sh 的索引搜，再拉下来比内容确认 ——
 * 同名不代表同源，记错了 update 会拿陌生仓库的内容合并你的文件。
 */
export async function track(options: TrackOptions = {}): Promise<void> {
  await ensureSafetyNet();

  const state = await syncFromLock();
  const targets = resolveTargets(state, options.ids);

  if (targets.length === 0) {
    printWarning(
      options.ids?.length
        ? "指定的 skill 不在本体库里"
        : "所有 skill 都已有上游记录"
    );
    return;
  }

  console.log(
    colors.gray(
      `${targets.length} 个 skill 待追踪上游。每个要拉取候选对比内容，较慢`
    )
  );

  let recorded = 0;
  for (const [index, id] of targets.entries()) {
    try {
      if (await handleOne(id, index + 1, targets.length, state, options)) {
        recorded += 1;
      }
    } catch (error) {
      if (error instanceof PromptCancelled) {
        console.log("");
        console.log(colors.gray(`已中断。已记录 ${recorded} 个，其余保持原样`));
        return;
      }
      printWarning(
        `      ${id} 处理失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  console.log("");
  if (recorded > 0) {
    printSuccess(
      `已为 ${recorded} 个 skill 记录上游，现在可以 agent check / agent update 了`
    );
  } else {
    printWarning("没有记录任何上游");
  }
}
