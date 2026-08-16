import { isAccessible, writeFile } from "@visulima/fs";
import { join } from "@visulima/path";
import simpleGit, { type SimpleGit } from "simple-git";
import { libraryDir } from "./paths";

/**
 * 把本体库变成 git 仓库。
 *
 * 这是所有破坏性操作的安全网 —— 有了它，skills add 覆盖、三路合并、
 * 归一化都不再是「丢数据」，只是一次可 diff、可 revert 的提交。
 * 用户自己改完也能 git diff 看清动了什么。
 */

/** 本体库的 git 客户端 */
export function libraryGit(): SimpleGit {
  return simpleGit(libraryDir());
}

export async function isRepo(): Promise<boolean> {
  return await isAccessible(join(libraryDir(), ".git"));
}

const GITIGNORE = `# 本体库只跟踪 skill 内容本身
.DS_Store
Thumbs.db
`;

/**
 * 初始化仓库。
 *
 * 必须关掉行尾转换：这台机器 core.autocrlf 在 global 与 system 两层
 * 都是 true，git 会把 LF 换成 CRLF，使本体库内容与上游逐字节不同，
 * 四象限会把每个 skill 都误判为「本地已改」—— 这个 bug 之前踩过一次。
 */
export async function initRepo(): Promise<{ commit: string } | null> {
  if (await isRepo()) {
    return null;
  }

  const git = libraryGit();
  await git.init();
  await git.raw(["config", "core.autocrlf", "false"]);
  await git.raw(["config", "core.eol", "lf"]);
  // 提交者信息用仓库级设置，免得依赖全局配置是否存在
  await git.raw(["config", "user.name", "agent-cli"]);
  await git.raw(["config", "user.email", "agent-cli@localhost"]);

  const ignorePath = join(libraryDir(), ".gitignore");
  if (!(await isAccessible(ignorePath))) {
    await writeFile(ignorePath, GITIGNORE);
  }

  await git.add(".");
  const result = await git.commit("chore: 本体库纳入版本管理");
  return { commit: result.commit };
}

export interface RepoStatus {
  /** 改动的文件数 */
  changedFiles: number;
  /** 有未提交的改动 */
  dirty: boolean;
  /** 当前 HEAD，空仓库时为 undefined */
  head?: string;
}

export async function repoStatus(): Promise<RepoStatus | null> {
  if (!(await isRepo())) {
    return null;
  }

  const git = libraryGit();
  const status = await git.status();
  let head: string | undefined;
  try {
    head = (await git.revparse(["HEAD"])).trim();
  } catch {
    // 空仓库还没有 HEAD
  }

  return {
    changedFiles: status.files.length,
    dirty: status.files.length > 0,
    ...(head ? { head } : {}),
  };
}

/**
 * 把当前改动提交为一个检查点。
 *
 * 用在破坏性操作之前 —— 先落一个可回退的点，之后无论怎么改都能 revert。
 * 无改动时返回 null，不产生空提交。
 */
export async function checkpoint(message: string): Promise<string | null> {
  if (!(await isRepo())) {
    return null;
  }

  const git = libraryGit();
  const status = await git.status();
  if (status.files.length === 0) {
    return null;
  }

  await git.add(".");
  const result = await git.commit(message);
  return result.commit;
}

/** 某个 skill 目录相对本体库的改动摘要 */
export async function skillDiff(id: string): Promise<string> {
  if (!(await isRepo())) {
    return "";
  }
  const git = libraryGit();
  return await git.diff(["--stat", "HEAD", "--", id]);
}
