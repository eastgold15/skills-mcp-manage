import { symlink } from "node:fs/promises";
import { copy, ensureDir, isAccessible, remove } from "@visulima/fs";
import { dirname, normalize } from "@visulima/path";
import { calculateDirectoryHash } from "../utils/hash";
import { libraryTarget, outsiders } from "./scan";
import type { ScanHit } from "./types";

/** 一个位置归一化后的结果 */
export type NormalizeOutcome =
  /** 已复制进本体库，原位置替换为链接 */
  | "adopted"
  /** 本体库已有同名且内容一致，原位置直接换成链接 */
  | "linked"
  /** 本体库已有同名但内容不同 —— 不动，交给人决定 */
  | "diverged"
  /** 已经是指向本体库的链接，无需处理 */
  | "already"
  /** 是指向别处的链接，不属于我们，不碰 */
  | "external"
  /** 失败（权限等） */
  | "failed";

export interface NormalizeResult {
  id: string;
  outcome: NormalizeOutcome;
  path: string;
  /** outcome 为 failed 时的原因 */
  reason?: string;
}

/** 链接是否已指向本体库中该 id 的位置 */
function pointsToTarget(target: string, id: string): boolean {
  return normalize(target) === normalize(libraryTarget(id));
}

/** 用真实目录替换为指向本体库的链接 */
async function relink(path: string, id: string): Promise<void> {
  await remove(path);
  await ensureDir(dirname(path));
  // junction 与 skills.sh 保持一致：Windows 下不需要管理员权限
  await symlink(libraryTarget(id), path, "junction");
}

/**
 * 归一化单个位置。
 *
 * 保守原则：本体库已有同名但内容不同时**绝不覆盖**，
 * 报 diverged 让人决定 —— 静默覆盖用户的本地修改是不可接受的。
 */
export async function normalizeOne(hit: ScanHit): Promise<NormalizeResult> {
  const { id, path } = hit;
  const base = { id, path };

  if (hit.isLink) {
    if (hit.target && pointsToTarget(hit.target, id)) {
      return { ...base, outcome: "already" };
    }
    // 指向别处的链接是别的工具的资产，不动
    return { ...base, outcome: "external" };
  }

  const target = libraryTarget(id);

  try {
    if (await isAccessible(target)) {
      const [here, there] = await Promise.all([
        calculateDirectoryHash(path),
        calculateDirectoryHash(target),
      ]);
      if (here !== there) {
        return { ...base, outcome: "diverged" };
      }
      // 内容一致，原地换链接不丢任何东西
      await relink(path, id);
      return { ...base, outcome: "linked" };
    }

    // 本体库还没有：先复制进去，确认落地后再替换原位置
    await copy(path, target, { recursive: true });
    if (!(await isAccessible(target))) {
      return { ...base, outcome: "failed", reason: "复制到本体库后校验失败" };
    }
    await relink(path, id);
    return { ...base, outcome: "adopted" };
  } catch (error) {
    return {
      ...base,
      outcome: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 批量归一化：把本体库外的 skill 收编，原位置替换为链接。
 *
 * 只处理本体库之外的位置；本体库自身是目标，不参与。
 */
export async function normalizeAll(
  hits: ScanHit[]
): Promise<NormalizeResult[]> {
  const results: NormalizeResult[] = [];
  for (const hit of outsiders(hits)) {
    results.push(await normalizeOne(hit));
  }
  return results;
}
