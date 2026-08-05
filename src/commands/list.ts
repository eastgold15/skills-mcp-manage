import { isAccessible } from "@visulima/fs";
import { scopeDir } from "../core/paths";
import { outsiders, readScanCache, reevaluate } from "../core/scan";
import type { SkillView, SyncStatus } from "../core/types";
import { buildViews } from "../core/view";
import { colors } from "../ui/colors";
import { printTable } from "../ui/prompts";

/** 状态列的着色 */
const STATUS_TEXT: Record<SyncStatus, (text: string) => string> = {
  behind: colors.success,
  conflicted: colors.warning,
  diverged: colors.warning,
  "local-only": colors.info,
  "no-upstream": colors.gray,
  unknown: colors.gray,
  "up-to-date": colors.gray,
};

const STATUS_LABEL: Record<SyncStatus, string> = {
  behind: "有新版本",
  conflicted: "有冲突待解",
  diverged: "有新版+本地改",
  "local-only": "本地已改",
  "no-upstream": "-",
  unknown: "未检查",
  "up-to-date": "已是最新",
};

/**
 * 启用标记用半角字符。
 *
 * ● ○ — 属于 Unicode「东亚歧义宽度」：tabular 按全角（2 格）算，
 * 终端却按半角（1 格）渲染，于是每个这样的单元格都少一格，整列错位。
 * 纯中文列反而没问题 —— 中文是明确的全角。换半角字符最省事。
 */
const ON = "v";
const OFF = "-";

/** 状态列文本，带新鲜度 */
function statusCell(view: SkillView): string {
  const paint = STATUS_TEXT[view.status];
  const label = STATUS_LABEL[view.status];

  if (view.status === "conflicted") {
    return paint(`${label} ${view.conflicts}`);
  }
  // 已是最新／本地已改这类结论有时效，标上日期免得误以为是实时的
  if (
    view.checkedAt &&
    (view.status === "up-to-date" || view.status === "local-only")
  ) {
    return paint(`${label} ${view.checkedAt.slice(5, 10)}`);
  }
  return paint(label);
}

/**
 * 提示待归一化的位置。
 *
 * 只读缓存、只提示，不动文件 —— ls 是随手就敲的只读命令，
 * 让它移动文件一旦规则写错就是无声的批量改动。
 * 副作用留给 agent scan --normalize --apply。
 */
async function hintPending(): Promise<void> {
  const cache = await readScanCache();
  if (!cache) {
    console.log(
      colors.gray("还没扫过磁盘。跑 agent scan 找出散落各处的 skill")
    );
    return;
  }

  const pending = outsiders(await reevaluate(cache)).filter((h) => !h.isLink);
  if (pending.length === 0) {
    return;
  }
  console.log(
    colors.warning(
      `${pending.length} 处 skill 还在本体库外，未纳管。用 agent scan --normalize 查看`
    )
  );
}

/** 底部统计与下一步提示 */
function summarize(views: SkillView[], hidden: number): void {
  const tracked = views.filter((v) => v.tracked).length;
  const enabled = views.filter(
    (v) => v.enabledGlobal || v.enabledProject
  ).length;
  const behind = views.filter(
    (v) => v.status === "behind" || v.status === "diverged"
  ).length;
  const unknown = views.filter((v) => v.status === "unknown").length;

  console.log(
    colors.gray(
      `共 ${views.length} 个，${tracked} 个已追踪上游，${enabled} 个已启用`
    )
  );
  if (behind > 0) {
    console.log(colors.success(`${behind} 个有新版本可更新`));
  }
  if (unknown > 0) {
    console.log(
      colors.gray(
        `${unknown} 个状态未知 —— 跑 agent check 联网核对（状态列的结论来自上次检查）`
      )
    );
  }
  if (hidden > 0) {
    console.log(colors.gray(`另有 ${hidden} 个已失联记录，用 --all 查看`));
  }
}

/**
 * 列出本体库全部 skill。
 *
 * 「上游」与「状态」是两件事，分两列：
 *  - 上游：lock 里有没有记录，决定**能不能** update
 *  - 状态：上次检查的结论，回答**要不要** update
 * 合成一列会让人以为「可更新」等于「有新版本」，实际跑 update 却
 * 提示无变化 —— 这正是原先的设计问题。
 *
 * 项目列只在当前目录确实是个项目（有 .claude/skills）时才出现，
 * 否则那一列全是 OFF，纯占宽度。
 */
export async function list(
  projectPath: string,
  asJson = false,
  showAll = false
): Promise<void> {
  const all = await buildViews(projectPath);
  const views = showAll ? all : all.filter((v) => !v.orphaned);
  const hidden = all.length - views.length;

  if (asJson) {
    console.log(JSON.stringify(showAll ? all : views, null, 2));
    return;
  }

  if (views.length === 0) {
    console.log(colors.info("本体库为空。用 skills.sh 安装 skill 后再回来"));
    if (hidden > 0) {
      console.log(colors.gray(`另有 ${hidden} 个已失联记录，用 --all 查看`));
    }
    await hintPending();
    return;
  }

  const projectRoot = scopeDir("project", projectPath);
  const inProject = await isAccessible(projectRoot);

  const headers = ["ID", "上游", "状态", "全局"];
  if (inProject) {
    headers.push("项目");
  }
  headers.push("");

  const rows = views.map((v) => {
    const row = [
      v.orphaned ? colors.gray(v.id) : v.id,
      v.tracked ? colors.info("已追踪") : colors.gray("无"),
      statusCell(v),
      v.enabledGlobal ? colors.info(ON) : colors.gray(OFF),
    ];
    if (inProject) {
      row.push(v.enabledProject ? colors.info(ON) : colors.gray(OFF));
    }
    row.push(v.orphaned ? colors.warning("已失联") : "");
    return row;
  });

  printTable(headers, rows);
  if (inProject) {
    console.log(colors.gray(`项目：${projectPath}`));
  }
  summarize(views, hidden);
  await hintPending();
}
