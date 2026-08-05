import { lstat, readlink, symlink } from "node:fs/promises";
import { ensureDir, isAccessible, remove } from "@visulima/fs";
import { join } from "@visulima/path";
import { libraryDir, scopeDir, scopeLink, skillDir } from "./paths";
import type { LinkKind, Scope, ScopeEntry } from "./types";

/**
 * 作用域层：管理 ~/.claude/skills 与 <project>/.claude/skills 里的链接。
 *
 * 启用状态不落盘 —— 文件系统的链接实况就是唯一真理，因此永不失同步。
 * 归属靠链接指向判断：指向本体库的是我们管的，指向别处的是外部工具建的。
 *
 * 用 junction 而非 symlink：Windows 下 junction 不需要管理员权限或开发者模式，
 * 且 skills.sh 自己用的就是 junction。Node 层面两者的 lstat/readlink 表现一致。
 */

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** 判断链接目标是否落在我们的本体库内 */
function pointsToLibrary(target: string): boolean {
  return normalize(target).startsWith(normalize(libraryDir()));
}

async function classify(path: string): Promise<{
  kind: LinkKind;
  target?: string;
}> {
  const stat = await lstat(path);

  if (!stat.isSymbolicLink()) {
    // 真实目录 —— 拷进来的副本，未纳管
    return { kind: "directory" };
  }

  const target = await readlink(path);
  return {
    kind: pointsToLibrary(target) ? "managed" : "external",
    target,
  };
}

/** 扫某个作用域下的全部条目及其形态 */
export async function scanScope(
  scope: Scope,
  projectPath: string
): Promise<ScopeEntry[]> {
  const dir = scopeDir(scope, projectPath);
  if (!(await isAccessible(dir))) {
    return [];
  }

  // 不能用 walk：它会跟随链接去读目标内容，这里只要顶层条目本身
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(dir);
  const entries: ScopeEntry[] = [];

  for (const id of names.sort()) {
    const { kind, target } = await classify(join(dir, id));
    entries.push({ id, kind, ...(target ? { target } : {}) });
  }

  return entries;
}

/** 该 scope 下由我们管理的 skill id 集合 */
export async function managedIds(
  scope: Scope,
  projectPath: string
): Promise<Set<string>> {
  const entries = await scanScope(scope, projectPath);
  return new Set(entries.filter((e) => e.kind === "managed").map((e) => e.id));
}

export type EnableOutcome =
  | "enabled"
  | "already-enabled"
  /** 该位置已被真实目录或外部链接占用，不覆盖 */
  | "occupied"
  /** 本体库里没有这个 skill */
  | "missing";

/** 在作用域下建立指向本体库的链接 */
export async function enableSkill(
  scope: Scope,
  projectPath: string,
  id: string
): Promise<EnableOutcome> {
  const source = skillDir(id);
  if (!(await isAccessible(source))) {
    return "missing";
  }

  const dir = scopeDir(scope, projectPath);
  await ensureDir(dir);
  const link = scopeLink(scope, projectPath, id);

  if (await isAccessible(link)) {
    const { kind } = await classify(link);
    return kind === "managed" ? "already-enabled" : "occupied";
  }

  await symlink(source, link, "junction");
  return "enabled";
}

export type DisableOutcome =
  | "disabled"
  | "not-enabled"
  /** 是真实目录或外部链接，不属于我们，拒绝删除 */
  | "not-managed";

/** 删除作用域下的链接。本体库不受影响 */
export async function disableSkill(
  scope: Scope,
  projectPath: string,
  id: string
): Promise<DisableOutcome> {
  const link = scopeLink(scope, projectPath, id);

  if (!(await isAccessible(link))) {
    return "not-enabled";
  }

  const { kind } = await classify(link);
  if (kind !== "managed") {
    return "not-managed";
  }

  await remove(link);
  return "disabled";
}
