import { createHash } from "node:crypto";
import { readFile, walk } from "@visulima/fs";
import { normalizePath } from "./path";

/**
 * 递归计算目录哈希。
 *
 * 哈希只依赖「文件内容 + 相对路径」，不含 size / mtime：
 * mtime 入哈希会让内容未变但经过 copy/checkout 的目录被误判为已修改。
 */
export async function calculateDirectoryHash(dirPath: string): Promise<string> {
  const hash = createHash("sha1");
  const files = await collectFiles(dirPath);

  // 预先创建全部Promise，不等待执行
  const filePromises = files.map(async (filePath) => {
    const buffer = await readFile(filePath, { buffer: true });
    const key = relativeKey(dirPath, filePath);
    return { buffer, key };
  });

  // 按原始顺序串行消费结果（Promise.all不打乱顺序！）
  // 注意：Promise.all会并发执行IO，但返回数组顺序永远和输入数组一致
  const entries = await Promise.all(filePromises);

  for (const { buffer, key } of entries) {
    hash.update(buffer);
    hash.update(key);
  }

  return hash.digest("hex");
}

/** 递归收集目录下所有文件，按相对路径排序以保证跨平台顺序稳定 */
async function collectFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  for await (const entry of walk(dirPath, {
    followSymlinks: false,
    includeDirs: false,
  })) {
    files.push(entry.path);
  }

  return files.sort((a, b) =>
    relativeKey(dirPath, a).localeCompare(relativeKey(dirPath, b))
  );
}

/** 取相对于根目录的路径，统一分隔符，让哈希在 Windows 与 POSIX 上一致 */
function relativeKey(dirPath: string, filePath: string): string {
  return normalizePath(filePath).slice(normalizePath(dirPath).length);
}

export async function calculateFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath, { buffer: true });
  return createHash("sha1").update(content).digest("hex");
}
