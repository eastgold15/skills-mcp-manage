import { createMCPEngine, type MCPEngine } from "../engines/mcp-engine";
import { createSkillEngine, type SkillEngine } from "../engines/skill-engine";
import { createRepoManager } from "../git/repo-manager";
import { ensureCacheDir, getConfig } from "./config";

export interface AgentContext {
  cacheRoot: string;
  mcpEngine: MCPEngine;
  projectPath: string;
  skillEngine: SkillEngine;
}

let cached: AgentContext | undefined;

/**
 * 惰性构建运行上下文并缓存。
 *
 * cerebro 在模块顶层注册命令、没有 async main 包裹，因此上下文只能在
 * execute 内按需获取。这样 `agent --help` / `--version` 也不会白跑一次
 * 配置读取与缓存目录创建。
 */
export async function getContext(): Promise<AgentContext> {
  if (cached) {
    return cached;
  }

  const config = await getConfig();
  const cacheRoot = await ensureCacheDir(config.cacheRoot);
  const repoManager = createRepoManager();

  cached = {
    cacheRoot,
    mcpEngine: createMCPEngine(repoManager, cacheRoot),
    projectPath: process.cwd(),
    skillEngine: createSkillEngine(repoManager, cacheRoot),
  };

  return cached;
}
