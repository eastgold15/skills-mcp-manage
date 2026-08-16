import { symlink } from "node:fs/promises";
import { copy, ensureDir, isAccessible, remove } from "@visulima/fs";
import { join } from "@visulima/path";
import { calculateDirectoryHash } from "../utils/hash";
import { mapDirectory } from "./diff";
import { libraryTarget, outsiders } from "./scan";
import type { ScanHit } from "./types";

/** 某个位置与本体库的差异 */
export interface Divergence {
  /** 两边都有但内容不同的文件（相对路径） */
  changed: string[];
  id: string;
  /** 本体库里的路径 */
  library: string;
  /** 只在本体库有的文件 */
  onlyInLibrary: string[];
  /** 只在这个位置有的文件 */
  onlyOutside: string[];
  /** 本体库外的路径 */
  outside: string;
}

/**
 * 找出所有与本体库同名但内容不同的位置。
 *
 * 这些是 normalizeOne 报 diverged 的那批 —— 归一化拒绝处理它们，
 * 必须先由人决定保留哪份。
 */
export async function findDivergences(hits: ScanHit[]): Promise<Divergence[]> {
  const result: Divergence[] = [];

  for (const hit of outsiders(hits)) {
    if (hit.isLink) {
      continue;
    }
    const library = libraryTarget(hit.id);
    if (!(await isAccessible(library))) {
      continue;
    }

    const [here, there] = await Promise.all([
      calculateDirectoryHash(hit.path),
      calculateDirectoryHash(library),
    ]);
    if (here === there) {
      continue;
    }

    const [outsideMap, libraryMap] = await Promise.all([
      mapDirectory(hit.path),
      mapDirectory(library),
    ]);

    const changed: string[] = [];
    const onlyOutside: string[] = [];
    for (const [path, hash] of outsideMap) {
      const other = libraryMap.get(path);
      if (other === undefined) {
        onlyOutside.push(path);
      } else if (other !== hash) {
        changed.push(path);
      }
    }
    const onlyInLibrary = [...libraryMap.keys()].filter(
      (path) => !outsideMap.has(path)
    );

    result.push({
      changed: changed.sort((a, b) => a.localeCompare(b)),
      id: hit.id,
      library,
      onlyInLibrary: onlyInLibrary.sort((a, b) => a.localeCompare(b)),
      onlyOutside: onlyOutside.sort((a, b) => a.localeCompare(b)),
      outside: hit.path,
    });
  }

  return result.sort((a, b) => a.id.localeCompare(b.id));
}

/** 差异涉及的全部文件 */
export function touchedFiles(divergence: Divergence): string[] {
  return [
    ...divergence.changed,
    ...divergence.onlyOutside,
    ...divergence.onlyInLibrary,
  ].sort((a, b) => a.localeCompare(b));
}

/**
 * 用外部位置的内容覆盖本体库。
 *
 * 用在「决定以项目那份为准」之后。调用方随后要 linkToLibrary 收尾。
 */
export async function adoptOutside(divergence: Divergence): Promise<void> {
  await remove(divergence.library);
  await ensureDir(join(divergence.library, ".."));
  await copy(divergence.outside, divergence.library, { recursive: true });
}

/**
 * 删掉外部位置，换成指向本体库的链接。
 *
 * 与 normalizeOne 的区别：**不做内容比对**。
 * normalizeOne 的 diverged 守卫是给自动批量用的 —— 那时没人做决定，
 * 内容不同就必须保守停手。而走到这里意味着用户已经明确决定了
 * 「以本体库为准，丢弃外部那份」，再拦一次就是把用户的决定挡掉。
 */
export async function linkToLibrary(divergence: Divergence): Promise<void> {
  await remove(divergence.outside);
  await ensureDir(join(divergence.outside, ".."));
  // junction 与 skills.sh 保持一致：Windows 下不需要管理员权限
  await symlink(divergence.library, divergence.outside, "junction");
}
