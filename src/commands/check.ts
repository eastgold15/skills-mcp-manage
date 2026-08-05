import { checkSkill, isCheckError } from "../core/check";
import { syncFromLock } from "../core/state";
import { colors } from "../ui/colors";
import { printSuccess, printTable, printWarning } from "../ui/prompts";
import { withSpinner } from "../ui/spinner";

export interface CheckOptions {
  asJson?: boolean;
  /** 只检查这些 id，省略则检查全部有上游的 */
  ids?: string[];
}

interface Row {
  detail: string;
  id: string;
  label: string;
}

/** 有新版本时的行 */
function behindRow(id: string, localChanged: boolean): Row {
  return {
    detail: localChanged ? "你也改过，update 会三路合并" : "update 可直接快进",
    id,
    label: localChanged
      ? colors.warning("有新版本 + 本地已改")
      : colors.success("有新版本"),
  };
}

/** 上游没变时的行 */
function currentRow(
  id: string,
  localChanged: boolean,
  noBaseline: boolean
): Row {
  let detail = "";
  if (noBaseline) {
    detail = "尚无基线，本地改动无从判断";
  } else if (localChanged) {
    detail = "上游没动，本地改动会保留";
  }

  return {
    detail,
    id,
    label: localChanged
      ? colors.info("已是最新（本地已改）")
      : colors.gray("已是最新"),
  };
}

/** 逐个检查并收集结果 */
async function runChecks(
  targets: string[],
  state: Awaited<ReturnType<typeof syncFromLock>>
): Promise<{ behind: number; failed: number; rows: Row[] }> {
  const rows: Row[] = [];
  let behind = 0;
  let failed = 0;

  for (const id of targets) {
    const result = await withSpinner(`正在检查 ${id}`, () =>
      checkSkill(id, state)
    );

    if (isCheckError(result)) {
      failed += 1;
      rows.push({
        detail: result.kind === "failed" ? result.reason : result.kind,
        id,
        label: colors.warning("检查失败"),
      });
      continue;
    }

    if (result.upstreamChanged) {
      behind += 1;
      rows.push(behindRow(id, result.localChanged));
      continue;
    }

    rows.push(currentRow(id, result.localChanged, result.noBaseline));
  }

  return { behind, failed, rows };
}

/**
 * 联网检查上游状态。
 *
 * 这是 ls 能显示「有没有新版本」的前提 —— 那个问题本地无从推导，
 * lockFolderHash 是 skills.sh 安装时算的，不随上游变化。
 * 只看不动：拉上游、比四象限、把结论写进 state，本体库不碰。
 */
export async function check(options: CheckOptions = {}): Promise<void> {
  const state = await syncFromLock();
  const tracked = Object.entries(state.skills)
    .filter(([, skill]) => skill.upstream && !skill.orphaned)
    .map(([id]) => id);

  const targets = options.ids?.length
    ? options.ids.filter((id) => tracked.includes(id))
    : tracked;

  if (targets.length === 0) {
    printWarning(
      options.ids?.length
        ? "指定的 skill 没有上游记录，无法检查"
        : "没有带上游的 skill 可检查"
    );
    return;
  }

  const { behind, failed, rows } = await runChecks(targets, state);

  if (options.asJson) {
    console.log(JSON.stringify({ skills: rows }, null, 2));
    return;
  }

  printTable(
    ["ID", "结果", "说明"],
    rows.map((r) => [r.id, r.label, colors.gray(r.detail)])
  );

  if (behind > 0) {
    printSuccess(
      `${behind} 个有新版本可更新，跑 agent update 处理（结果已记入，ls 可见）`
    );
  } else if (failed === 0) {
    printSuccess("全部已是最新");
  }
  if (failed > 0) {
    printWarning(`${failed} 个检查失败，详见上表`);
  }
}
