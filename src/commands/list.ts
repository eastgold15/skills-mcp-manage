import { outsiders, readScanCache, reevaluate } from "../core/scan";
import { buildViews } from "../core/view";
import { colors } from "../ui/colors";
import { printTable } from "../ui/prompts";

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

/**
 * 列出本体库全部 skill。
 *
 * 默认隐藏已失联的（本体库里已不存在）—— 它们的记录只为保住 base 快照
 * 与合并历史，天天列出来只会淹没真实条目。用 --all 查看。
 * asJson 给 AI 与脚本用：表格带 ANSI 颜色码，机器解析不可靠。
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

  const rows = views.map((v) => [
    v.orphaned ? colors.gray(v.id) : v.id,
    // 「有上游」是能力而非待办：有上游才可以执行 update，
    // 与「现在是否有新版本」无关 —— 后者要连网才知道。
    v.updatable ? colors.info("有") : colors.gray("无"),
    v.enabledGlobal ? colors.info("●") : colors.gray("○"),
    v.enabledProject ? colors.info("●") : colors.gray("○"),
    v.orphaned ? colors.warning("已失联") : "",
  ]);

  printTable(["ID", "上游", "全局", "项目", ""], rows);

  const updatable = views.filter((v) => v.updatable).length;
  const enabled = views.filter(
    (v) => v.enabledGlobal || v.enabledProject
  ).length;
  console.log(
    colors.gray(
      `共 ${views.length} 个，${updatable} 个有上游（可 update），${enabled} 个已启用`
    )
  );
  if (hidden > 0) {
    console.log(colors.gray(`另有 ${hidden} 个已失联记录，用 --all 查看`));
  }
  await hintPending();
}
