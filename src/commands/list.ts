import { buildViews } from "../core/view";
import { colors } from "../ui/colors";
import { printTable } from "../ui/prompts";

/**
 * 列出本体库全部 skill。
 *
 * asJson 给 AI 与脚本用：表格带 ANSI 颜色码，机器解析不可靠。
 */
export async function list(projectPath: string, asJson = false): Promise<void> {
  const views = await buildViews(projectPath);

  if (asJson) {
    console.log(JSON.stringify(views, null, 2));
    return;
  }

  if (views.length === 0) {
    console.log(colors.info("本体库为空。用 skills.sh 安装 skill 后再回来"));
    return;
  }

  const rows = views.map((v) => [
    v.orphaned ? colors.gray(v.id) : v.id,
    v.updatable ? colors.success("可更新") : colors.gray("无上游"),
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
      `共 ${views.length} 个，${updatable} 个可更新，${enabled} 个已启用`
    )
  );
}
