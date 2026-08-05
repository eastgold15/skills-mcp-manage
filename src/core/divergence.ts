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
 * 用外部位置的内容覆盖本体库，然后把外部换成链接。
 *
 * 用在「编辑器里改完，决定以这一份为准」之后。
 */
export async function adoptOutside(divergence: Divergence): Promise<void> {
  await remove(divergence.library);
  await ensureDir(join(divergence.library, ".."));
  await copy(divergence.outside, divergence.library, { recursive: true });
}
