import { disableSkill, scanScope } from "../core/scope";
import type { Scope } from "../core/types";
import {
  askMultiSelect,
  askSelect,
  printSuccess,
  printWarning,
} from "../ui/prompts";

/** 逐个删链接并汇报结果 */
async function applyDisable(
  scope: Scope,
  projectPath: string,
  ids: string[]
): Promise<void> {
  let done = 0;
  for (const id of ids) {
    const outcome = await disableSkill(scope, projectPath, id);
    if (outcome === "disabled") {
      done += 1;
    } else if (outcome === "not-managed") {
      printWarning(`${id}：非本工具建立，拒绝删除`);
    } else {
      printWarning(`${id}：未启用，跳过`);
    }
  }

  if (done > 0) {
    printSuccess(`已卸载 ${done} 个 skill（本体库未受影响）`);
  }
}

/**
 * 批量卸载：删除作用域下的链接。本体库不受影响。
 *
 * 只列出我们建的链接 —— 外部工具建的链接与手写的真实目录不在候选里，
 * 避免误删不属于本工具的东西。
 * 传了 ids 就直接执行，不进 TUI —— 这条路径给 AI 与脚本用。
 */
export async function disable(
  projectPath: string,
  presetScope?: Scope,
  ids?: string[]
): Promise<void> {
  if (ids && ids.length > 0) {
    await applyDisable(presetScope ?? "project", projectPath, ids);
    return;
  }

  const scope =
    presetScope ??
    (await askSelect<Scope>("从哪个作用域卸载？", [
      { hint: "./.claude/skills", label: "项目", value: "project" },
      { hint: "~/.claude/skills", label: "全局", value: "global" },
    ]));

  const entries = await scanScope(scope, projectPath);
  const managed = entries.filter((e) => e.kind === "managed");
  const label = scope === "global" ? "全局" : "项目";

  if (managed.length === 0) {
    const others = entries.length - managed.length;
    printWarning(
      others > 0
        ? `${label}作用域没有本工具管理的 skill（另有 ${others} 个外部链接或副本，用 doctor 查看）`
        : `${label}作用域没有已启用的 skill`
    );
    return;
  }

  const picked = await askMultiSelect<string>(
    `选择要从${label}作用域卸载的 skill（空格多选）`,
    managed.map((e) => ({ label: e.id, value: e.id }))
  );

  if (picked.length === 0) {
    printWarning("未选择任何 skill");
    return;
  }

  await applyDisable(scope, projectPath, picked);
}
