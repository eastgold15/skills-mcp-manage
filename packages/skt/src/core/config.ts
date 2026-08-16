import { isAccessible, readJson, writeJson } from "@visulima/fs";
import { matcher } from "@visulima/fs/match";
import { join, normalize } from "@visulima/path";
import { agentsRoot, homeDir } from "./paths";
import type { ScanConfig } from "./types";

const CONFIG_VERSION = 1;

/** ~/.agents/.skill-scan.json —— 扫描策略，由用户手工维护 */
export function configFile(): string {
  return join(agentsRoot(), ".skill-scan.json");
}

/**
 * 首次生成的默认配置。
 *
 * roots 是全盘扫的起点，include/exclude 决定哪些命中算「你的 skill」。
 * 默认 include 只放公认的安装位置，exclude 挡掉实测确认的第三方内置 ——
 * 这只是起点，配置就是给你改的。
 */
export function defaultConfig(): ScanConfig {
  return {
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      // 包管理器缓存
      "**/.bun/install/cache/**",
      "**/.npm/**",
      "**/.pnpm-store/**",
      // Claude Code 插件缓存与市场镜像
      "**/.claude/plugins/**",
      // 其他 skill 管理工具的缓存
      "**/.skills-manager/cache/**",
      // 各家客户端自带的内置资源（实测这台机器上有 660+ 处）
      "**/.trae-cn/builtin/**",
      "**/.trae/builtin/**",
      "**/bundled-skills/**",
      "**/AppData/Local/hermes/**",
      "**/AppData/Local/Hermes*/**",
      "**/AppData/Roaming/cn.org.hermesagent/**",
      "**/resources/app/extensions/**",
      // 临时目录与构建产物
      "**/.tmp/**",
      "**/Temp/**",
      "**/{dist,build,out,target,.next,.nuxt,.turbo,.cache,coverage}/**",
      // 系统目录
      "**/$Recycle.Bin/**",
      "**/Windows/**",
      // 我们自己的工作区与快照
      "**/.agents/.work/**",
      "**/.agents/.base/**",
      "**/.test-tmp/**",
    ],
    include: [
      // Claude Code 的全局与项目作用域
      "**/.claude/skills/*",
      // skills.sh 的位置
      "**/.agents/skills/*",
      // 其他客户端的 skill 目录
      "**/.codeg/skills/*",
      "**/.codex/skills/*",
      "**/.cursor/skills/*",
    ],
    roots: [normalize(homeDir()), "L:/Documents/GitHub"],
    version: CONFIG_VERSION,
  };
}

export async function readConfig(): Promise<ScanConfig | null> {
  const path = configFile();
  if (!(await isAccessible(path))) {
    return null;
  }
  const raw = await readJson<ScanConfig>(path);
  return raw.version === CONFIG_VERSION ? raw : null;
}

export async function writeConfig(config: ScanConfig): Promise<void> {
  await writeJson(configFile(), config, { indent: 2 });
}

/** 读配置，不存在则写入默认值后返回 */
export async function ensureConfig(): Promise<ScanConfig> {
  const existing = await readConfig();
  if (existing) {
    return existing;
  }
  const fresh = defaultConfig();
  await writeConfig(fresh);
  return fresh;
}

export interface Policy {
  /** 该路径是否被 exclude 挡掉 */
  excluded: (path: string) => boolean;
  /** 该路径是否命中 include */
  included: (path: string) => boolean;
}

/**
 * 把配置编译成判定函数。
 *
 * 用 posix 风格路径匹配：Windows 下反斜杠会让 glob 失效，
 * 统一 normalize 成正斜杠后再比。
 */
export function compilePolicy(config: ScanConfig): Policy {
  const isIncluded = matcher(config.include, { dot: true, posix: true });
  const isExcluded =
    config.exclude.length > 0
      ? matcher(config.exclude, { dot: true, posix: true })
      : () => false;

  return {
    excluded: (path) => isExcluded(normalize(path)),
    included: (path) => isIncluded(normalize(path)),
  };
}
