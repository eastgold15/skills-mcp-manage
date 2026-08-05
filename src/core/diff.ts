import { createHash } from "node:crypto";
import { isAccessible, readFile, walk } from "@visulima/fs";
import { normalizePath } from "../utils/path";
import type { Quadrant, QuadrantVerdict } from "./types";

/** 目录内所有文件的相对路径 → 内容哈希 */
export type FileMap = Map<string, string>;

/** 收集目录的文件清单，key 是统一分隔符的相对路径 */
export async function mapDirectory(dir: string): Promise<FileMap> {
  const map: FileMap = new Map();
  if (!(await isAccessible(dir))) {
    return map;
  }

  const root = normalizePath(dir);
  for await (const entry of walk(dir, {
    followSymlinks: false,
    includeDirs: false,
  })) {
    const relative = normalizePath(entry.path).slice(root.length + 1);
    const content = await readFile(entry.path, { buffer: true });
    map.set(relative, sha1(content));
  }
  return map;
}

/**
 * 同 mapDirectory，但先把 CRLF 归一成 LF 再算哈希。
 *
 * 用于「这两份是不是同一个东西」这类相似度判断：本机文件多为 CRLF、
 * 上游仓库为 LF，按原始字节比会得出「每个文件都不同」，数字毫无意义。
 * update 的四象限**不该**用这个 —— 那里需要严格的逐字节判定。
 */
export async function mapDirectoryNormalized(dir: string): Promise<FileMap> {
  const map: FileMap = new Map();
  if (!(await isAccessible(dir))) {
    return map;
  }

  const root = normalizePath(dir);
  for await (const entry of walk(dir, {
    followSymlinks: false,
    includeDirs: false,
  })) {
    const relative = normalizePath(entry.path).slice(root.length + 1);
    const raw = (await readFile(entry.path, { buffer: true })) as Uint8Array;
    map.set(relative, sha1(stripCarriageReturns(raw)));
  }
  return map;
}

/** 去掉所有 \r（0x0D），使 CRLF 与 LF 等价 */
function stripCarriageReturns(buffer: Uint8Array): Uint8Array {
  const out = new Uint8Array(buffer.length);
  let length = 0;
  for (const byte of buffer) {
    if (byte !== 0x0d) {
      out[length] = byte;
      length += 1;
    }
  }
  return out.subarray(0, length);
}

function sha1(buffer: Uint8Array): string {
  return createHash("sha1").update(buffer).digest("hex");
}

/** 两份文件清单是否完全一致 */
export function sameContent(a: FileMap, b: FileMap): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [path, hash] of a) {
    if (b.get(path) !== hash) {
      return false;
    }
  }
  return true;
}

/**
 * 四象限判定。
 *
 * 两个问题各有独立依据，都以 base 快照为参照系 —— 不需要 commit：
 *   本地改过？ ours   ≠ base
 *   上游变过？ theirs ≠ base
 *
 * 现有旧代码只比 ours 与自己记录的哈希，完全不看上游，
 * 导致本地一改就报冲突（连上游没动也报），这里修正。
 */
export function decideQuadrant(
  base: FileMap,
  ours: FileMap,
  theirs: FileMap
): QuadrantVerdict {
  const localChanged = !sameContent(base, ours);
  const upstreamChanged = !sameContent(base, theirs);

  let quadrant: Quadrant;
  if (!(localChanged || upstreamChanged)) {
    quadrant = 1;
  } else if (!localChanged && upstreamChanged) {
    quadrant = 2;
  } else if (localChanged && !upstreamChanged) {
    quadrant = 3;
  } else {
    quadrant = 4;
  }

  return { localChanged, quadrant, upstreamChanged };
}

export type FileVerdict =
  /** 两边都没动，或改成了同样的内容 */
  | "unchanged"
  /** 只有上游动了 → 取 theirs */
  | "take-theirs"
  /** 只有我们动了 → 保留 ours */
  | "keep-ours"
  /** 两边都动且不同 → 需要三路合并 */
  | "conflict"
  /** 上游新增 → 取 theirs */
  | "added-upstream"
  /** 我们新增 → 保留 ours */
  | "added-local"
  /** 上游删除且我们没改 → 删掉 */
  | "deleted-upstream"
  /** 上游删除但我们改过 → 需要人决定 */
  | "delete-conflict";

/** base 里没有该文件 —— 有一边或两边新增 */
function judgeAdded(
  ours: string | undefined,
  theirs: string | undefined
): FileVerdict {
  if (ours !== undefined && theirs !== undefined) {
    return ours === theirs ? "unchanged" : "conflict";
  }
  return theirs === undefined ? "added-local" : "added-upstream";
}

/** 我们删了该文件 */
function judgeLocalDeleted(
  base: string,
  theirs: string | undefined
): FileVerdict {
  // 上游也删了，或上游没动 → 都视为已删除，不必动作
  return theirs === undefined || theirs === base ? "unchanged" : "conflict";
}

/** 三方都有该文件 */
function judgeBothPresent(
  base: string,
  ours: string,
  theirs: string
): FileVerdict {
  const localTouched = ours !== base;
  const upstreamTouched = theirs !== base;

  if (!(localTouched || upstreamTouched)) {
    return "unchanged";
  }
  if (!localTouched) {
    return "take-theirs";
  }
  if (!upstreamTouched) {
    return "keep-ours";
  }
  // 两边都动了 —— 内容相同则无冲突
  return ours === theirs ? "unchanged" : "conflict";
}

function judgeOne(
  base: string | undefined,
  ours: string | undefined,
  theirs: string | undefined
): FileVerdict {
  if (base === undefined) {
    return judgeAdded(ours, theirs);
  }
  if (ours === undefined) {
    return judgeLocalDeleted(base, theirs);
  }
  if (theirs === undefined) {
    // 上游删了：本地没改就跟着删，改过则需人决定
    return ours === base ? "deleted-upstream" : "delete-conflict";
  }
  return judgeBothPresent(base, ours, theirs);
}

/**
 * 逐文件判定。
 *
 * 文件级粒度的意义：上游改 SKILL.md、我们改 references/usage.md
 * 可以自动合并，只有同一文件两边都改才需要人介入。
 */
export function decideFiles(
  base: FileMap,
  ours: FileMap,
  theirs: FileMap
): Map<string, FileVerdict> {
  const paths = [
    ...new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]),
  ].sort((a, b) => a.localeCompare(b));

  return new Map<string, FileVerdict>(
    paths.map((path) => [
      path,
      judgeOne(base.get(path), ours.get(path), theirs.get(path)),
    ])
  );
}

/** 需要人工介入的文件 */
export function conflictPaths(verdicts: Map<string, FileVerdict>): string[] {
  return [...verdicts]
    .filter(([, v]) => v === "conflict" || v === "delete-conflict")
    .map(([path]) => path);
}
