import { lstat, readlink } from "node:fs/promises";
import { isAccessible, readJson, walk, writeJson } from "@visulima/fs";
import { dirname, join, normalize } from "@visulima/path";
import { compilePolicy, ensureConfig, type Policy } from "./config";
import { libraryDir, scanCacheFile } from "./paths";
import type { ScanCache, ScanConfig, ScanHit } from "./types";

const CACHE_VERSION = 1;

/**
 * 判定为 skill 的条件：目录下直接含 SKILL.md。
 *
 * 就这一条，不看内容、不解析 frontmatter —— 简单可预测，
 * 用户手放一个目录进来也能立刻被认出。
 * 「是否算我的 skill」是另一回事，由配置的 include/exclude 决定。
 */
export const SKILL_MANIFEST = "SKILL.md";

/**
 * walk 的剪枝清单。
 *
 * 与配置的 exclude 是两回事：这里是为了不白跑（不进 node_modules
 * 走几十万个文件），配置的 exclude 才是策略判断。剪枝必须保守 ——
 * 剪掉的东西连「扫到但不收编」的机会都没有。
 */
const WALK_SKIP: RegExp[] = [
  /[\\/]node_modules[\\/]/,
  /[\\/]\.git[\\/]/,
  /[\\/]\$Recycle\.Bin[\\/]/i,
];

async function describeHit(
  skillPath: string,
  policy: Policy
): Promise<ScanHit> {
  const library = normalize(libraryDir());
  const normalized = normalize(skillPath);
  const id = normalized.split("/").pop() ?? normalized;

  let isLink = false;
  let target: string | undefined;
  try {
    const info = await lstat(skillPath);
    if (info.isSymbolicLink()) {
      isLink = true;
      target = await readlink(skillPath);
    }
  } catch {
    // 拿不到就当普通目录，不因单个条目失败中断整轮扫描
  }

  return {
    adoptable: policy.included(normalized) && !policy.excluded(normalized),
    id,
    inLibrary: normalized.startsWith(`${library}/`),
    isLink,
    path: skillPath,
    ...(target ? { target } : {}),
  };
}

/**
 * 扫描一个根目录下所有的 skill。
 *
 * 直接找 SKILL.md 文件再取其父目录，比逐层判断目录更省事。
 * maxDepth 兜住深层嵌套 —— 真实的 skill 不会埋在十几层下面。
 */
export async function scanRoot(
  root: string,
  policy: Policy,
  maxDepth = 8
): Promise<ScanHit[]> {
  if (!(await isAccessible(root))) {
    return [];
  }

  const hits: ScanHit[] = [];
  try {
    for await (const entry of walk(root, {
      followSymlinks: false,
      includeDirs: false,
      match: [/SKILL\.md$/],
      maxDepth,
      skip: WALK_SKIP,
    })) {
      hits.push(await describeHit(dirname(entry.path), policy));
    }
  } catch {
    // 权限不足等情况下返回已扫到的部分，不整轮失败
  }
  return hits;
}

/** 按路径去重后排序 */
function dedupe(hits: ScanHit[]): ScanHit[] {
  const seen = new Map<string, ScanHit>();
  for (const hit of hits) {
    seen.set(normalize(hit.path), hit);
  }
  return [...seen.values()].sort((a, b) => {
    // 本体库的排前面，便于归一化时确定基准
    if (a.inLibrary !== b.inLibrary) {
      return a.inLibrary ? -1 : 1;
    }
    return a.id.localeCompare(b.id) || a.path.localeCompare(b.path);
  });
}

/** 扫描给定的若干根目录，合并去重 */
export async function scanRoots(
  roots: string[],
  policy: Policy
): Promise<ScanHit[]> {
  const all: ScanHit[] = [];
  for (const root of roots) {
    all.push(...(await scanRoot(root, policy)));
  }
  return dedupe(all);
}

export async function writeScanCache(cache: ScanCache): Promise<void> {
  await writeJson(scanCacheFile(), cache, { indent: 2 });
}

/** 读缓存，不存在或版本不符则返回 null */
export async function readScanCache(): Promise<ScanCache | null> {
  const path = scanCacheFile();
  if (!(await isAccessible(path))) {
    return null;
  }
  const raw = await readJson<ScanCache>(path);
  return raw.version === CACHE_VERSION ? raw : null;
}

export interface ScanRun {
  cache: ScanCache;
  config: ScanConfig;
}

/**
 * 按配置扫描并落盘缓存。
 *
 * roots 传入则覆盖配置里的（指定位置扫描），否则用配置的 roots（全盘扫）。
 */
export async function scanAndCache(roots?: string[]): Promise<ScanRun> {
  const config = await ensureConfig();
  const policy = compilePolicy(config);
  const targets = roots?.length ? roots : config.roots;

  const hits = await scanRoots(targets, policy);
  const cache: ScanCache = {
    hits,
    roots: targets.map((r) => normalize(r)),
    scannedAt: new Date().toISOString(),
    version: CACHE_VERSION,
  };
  await writeScanCache(cache);
  return { cache, config };
}

/**
 * 用当前配置重新判定缓存里的命中。
 *
 * 改了配置不必重扫磁盘 —— adoptable 是纯函数判断，
 * 拿旧的路径清单重算即可，毫秒级。
 */
export async function reevaluate(cache: ScanCache): Promise<ScanHit[]> {
  const config = await ensureConfig();
  const policy = compilePolicy(config);
  return cache.hits.map((hit) => ({
    ...hit,
    adoptable:
      policy.included(normalize(hit.path)) &&
      !policy.excluded(normalize(hit.path)),
  }));
}

/** 本体库之外、且配置认可的，即归一化的候选 */
export function outsiders(hits: ScanHit[]): ScanHit[] {
  return hits.filter((hit) => !hit.inLibrary && hit.adoptable);
}

/** 扫到但配置没认可的 —— 只做展示，绝不收编 */
export function bystanders(hits: ScanHit[]): ScanHit[] {
  return hits.filter((hit) => !(hit.inLibrary || hit.adoptable));
}

/**
 * 同名冲突：同一个 id 在本体库外有多个真实目录。
 *
 * 归一化时只能挑一个作为本体，剩下的会变成指向它的链接 ——
 * 若内容不同就是静默的数据覆盖，所以必须先报出来让人决定。
 */
export function conflicts(hits: ScanHit[]): Map<string, ScanHit[]> {
  const byId = new Map<string, ScanHit[]>();
  for (const hit of outsiders(hits)) {
    if (hit.isLink) {
      continue;
    }
    const list = byId.get(hit.id) ?? [];
    list.push(hit);
    byId.set(hit.id, list);
  }

  const result = new Map<string, ScanHit[]>();
  for (const [id, list] of byId) {
    if (list.length > 1) {
      result.set(id, list);
    }
  }
  return result;
}

/** 归一化时某个 id 在本体库中的落点 */
export function libraryTarget(id: string): string {
  return join(libraryDir(), id);
}
