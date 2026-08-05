import { enableSkill } from "../core/scope";
import type { Scope } from "../core/types";
import { buildViews } from "../core/view";
import {
  askMultiSelect,
  askSelect,
  printSuccess,
  printWarning,
} from "../ui/prompts";

/**
 * 批量启用：从本体库挑若干 skill 链接到作用域。
 *
 * 不联网、不拷贝 —— 建 junction 即完成，第二个项目启用同一 skill 零成本。
 */
export async function enable(
  projectPath: string,
  presetScope?: Scope
): Promise<void> {
  const views = (await buildViews(projectPath)).filter((v) => !v.orphaned);

  if (views.length === 0) {
    printWarning("本体库为空，先用 skills.sh 安装 skill");
    return;
  }

  const scope =
    presetScope ??
    (await askSelect<Scope>("启用到哪个作用域？", [
      { hint: "./.claude/skills", label: "项目", value: "project" },
      { hint: "~/.claude/skills", label: "全局", value: "global" },
    ]));

  const isOn = (v: (typeof views)[number]) =>
    scope === "global" ? v.enabledGlobal : v.enabledProject;

  const candidates = views.filter((v) => !isOn(v));
  if (candidates.length === 0) {
    printWarning(
      `${scope === "global" ? "全局" : "项目"}作用域已启用全部 ${views.length} 个 skill`
    );
    return;
  }

  const ids = await askMultiSelect<string>(
    `选择要启用到${scope === "global" ? "全局" : "本项目"}的 skill（空格多选）`,
    candidates.map((v) => ({
      hint: v.updatable ? undefined : "无上游",
      label: v.id,
      value: v.id,
    }))
  );

  if (ids.length === 0) {
    printWarning("未选择任何 skill");
    return;
  }

  let done = 0;
  for (const id of ids) {
    const outcome = await enableSkill(scope, projectPath, id);
    if (outcome === "enabled") {
      done += 1;
    } else if (outcome === "occupied") {
      printWarning(`${id}：该位置已被真实目录或外部链接占用，跳过`);
    } else if (outcome === "missing") {
      printWarning(`${id}：本体库中不存在，跳过`);
    }
  }

  if (done > 0) {
    printSuccess(`已启用 ${done} 个 skill`);
  }
}
