import path from "@visulima/path";

/**
 * 解析 ~ 用户家目录路径
 * @param input 原始路径，支持 ~/xxx
 * @returns 展开后的真实路径
 */
export function resolveHomePath(input: string): string {
  if (!input) {
    return input;
  }

  if (input.startsWith("~")) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
    // 只替换字符串最开头的 ~，不会误伤路径中间出现的 ~
    return input.replace(/^~/, homeDir);
  }

  return input;
}

/**
 * 路径归一化，统一输出 Unix 正斜杠 /，抹平 Windows \ 差异
 * @param input 原始路径
 */
export function normalizePath(input: string): string {
  if (!input) {
    return input;
  }
  // @visulima/path.normalize 处理 ../ ./ 重复斜杠等，再强制转正斜杠
  return path.normalize(input).replace(/\\/g, "/");
}

/**
 * 根据缓存根目录 + git仓库地址，生成skills缓存目录
 * @param cacheRoot 缓存根路径
 * @param repoUrl git仓库地址(http/ssh)
 * @returns 归一化后的本地缓存目录
 */
export function getCachePath(cacheRoot: string, repoUrl: string): string {
  let repoName = "unknown";
  if (repoUrl) {
    repoName =
      repoUrl
        .replace(/\.git$/, "")
        .split("/")
        .pop() || "unknown";
  }
  // 使用 path.join 做安全路径拼接，不再手写 /
  const raw = path.join(cacheRoot, "skills", repoName);
  return normalizePath(raw);
}

/**
 * 在缓存路径下拼接子路径
 * @param cachePath 缓存根目录
 * @param subPath 子相对路径
 * @returns 归一化完整路径
 */
export function getSubPath(cachePath: string, subPath: string): string {
  const raw = path.join(cachePath, subPath);
  return normalizePath(raw);
}
