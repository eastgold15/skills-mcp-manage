import type { InstallOptions } from "../core/types";
import type { MCPEngine } from "../engines/mcp-engine";
import type { SkillEngine } from "../engines/skill-engine";
import { printSuccess } from "../ui/prompts";
import { withSpinner } from "../ui/spinner";

/**
 * 按来源前缀分流：registry: 走 MCP 引擎，其余走技能引擎。
 * 分流放在命令层，让 index.ts 只做壳。
 */
export async function install(
  projectPath: string,
  source: string,
  engines: { skillEngine: SkillEngine; mcpEngine: MCPEngine },
  options?: InstallOptions
): Promise<void> {
  const engine = source.startsWith("registry:")
    ? engines.mcpEngine
    : engines.skillEngine;

  await withSpinner(`正在安装 ${source}`, async () => {
    await engine.install(projectPath, source, options);
  });
  printSuccess(`已安装 ${source}`);
}
