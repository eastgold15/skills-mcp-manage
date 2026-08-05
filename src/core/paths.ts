import { join } from "@visulima/path";
import type { Scope } from "./types";

/**
 * 可覆盖的 ~/.agents 根，仅用于测试注入。
 * 生产代码一律不传，走真实家目录。
 */
let agentsRootOverride: string | undefined;

/** 可覆盖的全局作用域根（默认家目录），仅用于测试注入 */
let globalRootOverride: string | undefined;

/** 测试用：把 ~/.agents 指向临时目录 */
export function setAgentsRoot(path: string | undefined): void {
  agentsRootOverride = path;
}

/** 测试用：把全局作用域的家目录指向临时目录 */
export function setGlobalRoot(path: string | undefined): void {
  globalRootOverride = path;
}

/** 家目录，Windows 下走 USERPROFILE */
export function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || ".";
}

// ── skills.sh 的地盘（只读） ──────────────────────────────────

/** ~/.agents —— skills.sh 的根 */
export function agentsRoot(): string {
  return agentsRootOverride ?? join(homeDir(), ".agents");
}

/** ~/.agents/skills —— 本体库，唯一实体 */
export function libraryDir(): string {
  return join(agentsRoot(), "skills");
}

/** ~/.agents/skills/<id> */
export function skillDir(id: string): string {
  return join(libraryDir(), id);
}

/** ~/.agents/.skill-lock.json —— skills.sh 的总账，我们只读 */
export function lockFile(): string {
  return join(agentsRoot(), ".skill-lock.json");
}

// ── 我们的地盘 ───────────────────────────────────────────────

/** ~/.agents/.merge-state.json */
export function stateFile(): string {
  return join(agentsRoot(), ".merge-state.json");
}

/** ~/.agents/.base —— base 快照根 */
export function baseRoot(): string {
  return join(agentsRoot(), ".base");
}

/** ~/.agents/.base/<id> —— 上次同步时的上游快照 */
export function baseDir(id: string): string {
  return join(baseRoot(), id);
}

/** ~/.agents/.scan-cache.json —— 扫描结果缓存，避免 ls 每次全盘扫 */
export function scanCacheFile(): string {
  return join(agentsRoot(), ".scan-cache.json");
}

// ── 作用域 ───────────────────────────────────────────────────

/**
 * 作用域的 skills 目录。
 * 全局 ~/.claude/skills，项目 <projectPath>/.claude/skills
 */
export function scopeDir(scope: Scope, projectPath: string): string {
  const root =
    scope === "global" ? (globalRootOverride ?? homeDir()) : projectPath;
  return join(root, ".claude", "skills");
}

/** 作用域下某个 skill 的链接位置 */
export function scopeLink(
  scope: Scope,
  projectPath: string,
  id: string
): string {
  return join(scopeDir(scope, projectPath), id);
}
