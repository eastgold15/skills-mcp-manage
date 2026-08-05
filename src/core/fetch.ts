import { ensureDir, remove } from "@visulima/fs";
import { dirname, join } from "@visulima/path";
import simpleGit from "simple-git";

/**
 * 从 monorepo 拉取单个 skill 子目录。
 *
 * 用 sparse-checkout --cone + --depth 1：不必 clone 全仓，
 * 实测对 ast-grep/agent-skill 只拉目标子目录即可，顺带拿到 commit。
 */
export interface FetchResult {
  /** 上游 HEAD，仅作辅助记录，不承担判定正确性 */
  commit: string;
  /** 拉到的 skill 内容目录 */
  contentDir: string;
}

/** skillPath 形如 skills/foo/SKILL.md，取其所在目录 */
export function skillPathToDir(skillPath: string): string {
  const normalized = skillPath.replace(/\\/g, "/");
  return normalized.endsWith("/SKILL.md")
    ? normalized.slice(0, -"/SKILL.md".length)
    : dirname(normalized);
}

export async function fetchUpstream(
  sourceUrl: string,
  skillPath: string,
  workDir: string
): Promise<FetchResult> {
  await remove(workDir);
  await ensureDir(workDir);

  const subDir = skillPathToDir(skillPath);
  const git = simpleGit(workDir);

  await git.init();
  // 关掉行尾转换：用户的 core.autocrlf=true 会把 LF 换成 CRLF，
  // 使拉下来的内容与本体库逐字节不同，四象限会把每个 skill 都误判为本地已改。
  await git.raw(["config", "core.autocrlf", "false"]);
  await git.raw(["config", "core.eol", "lf"]);
  await git.addRemote("origin", sourceUrl);
  await git.raw(["config", "core.sparseCheckout", "true"]);
  await git.raw(["sparse-checkout", "init", "--cone"]);
  await git.raw(["sparse-checkout", "set", subDir]);
  await git.fetch(["--depth", "1", "origin", "HEAD"]);
  await git.checkout("FETCH_HEAD");

  const commit = (await git.revparse(["FETCH_HEAD"])).trim();

  return { commit, contentDir: join(workDir, subDir) };
}
