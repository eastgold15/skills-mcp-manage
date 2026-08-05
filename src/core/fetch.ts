import { VisulimaError } from "@visulima/error";
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
  /**
   * 实际使用的仓库内路径。
   * 与 lock 声明不一致时说明做了自动纠正，见 resolveSkillDir。
   */
  resolvedSkillPath: string;
}

/**
 * 拉取没能落地任何文件。
 *
 * 必须是显式错误而不是「拿到一个空目录」：空目录会被四象限判成
 * 「上游删光了所有文件」，进而把本体库里的内容真的删掉。
 * 曾因 lock 里 skillPath 与上游实际布局不符触发过一次真实数据丢失。
 */
export class UpstreamPathError extends VisulimaError {
  constructor(message: string) {
    super({ message, name: "UpstreamPathError" });
  }
}

/** skillPath 形如 skills/foo/SKILL.md，取其所在目录 */
export function skillPathToDir(skillPath: string): string {
  const normalized = skillPath.replace(/\\/g, "/");
  return normalized.endsWith("/SKILL.md")
    ? normalized.slice(0, -"/SKILL.md".length)
    : dirname(normalized);
}

/** 该目录在仓库文件清单里是否有内容 */
function hasFilesUnder(paths: string[], dir: string): boolean {
  const prefix = `${dir}/`;
  return paths.some((path) => path.startsWith(prefix));
}

/**
 * 在仓库文件清单里定位 skill 目录。
 *
 * lock 声明的路径优先；找不到时按目录名兜底搜索 —— skills.sh 记录的
 * 路径可能与上游实际布局不符（实测 b-open-io/prompts 的 npm-publish
 * 声明在 skills/ 下，实际在 modules/plugin-kit/skills/ 下）。
 * 兜底要求唯一命中，多个候选宁可报错也不猜。
 */
export function resolveSkillDir(paths: string[], declared: string): string {
  if (hasFilesUnder(paths, declared)) {
    return declared;
  }

  const name = declared.split("/").pop() ?? declared;
  const suffix = `/${name}/SKILL.md`;
  const candidates = [
    ...new Set(
      paths
        .filter((path) => path.endsWith(suffix) || path === `${name}/SKILL.md`)
        .map((path) => path.slice(0, -"/SKILL.md".length))
    ),
  ];

  if (candidates.length === 1) {
    return candidates[0] as string;
  }
  if (candidates.length > 1) {
    throw new UpstreamPathError(
      `上游有多个名为 ${name} 的 skill 目录，无法确定用哪个：${candidates.join("、")}`
    );
  }
  throw new UpstreamPathError(
    `上游仓库里找不到 ${declared}，也没有名为 ${name} 的 skill 目录`
  );
}

export async function fetchUpstream(
  sourceUrl: string,
  skillPath: string,
  workDir: string
): Promise<FetchResult> {
  await remove(workDir);
  await ensureDir(workDir);

  const declared = skillPathToDir(skillPath);
  const git = simpleGit(workDir);

  await git.init();
  // 关掉行尾转换：用户的 core.autocrlf=true 会把 LF 换成 CRLF，
  // 使拉下来的内容与本体库逐字节不同，四象限会把每个 skill 都误判为本地已改。
  await git.raw(["config", "core.autocrlf", "false"]);
  await git.raw(["config", "core.eol", "lf"]);
  await git.addRemote("origin", sourceUrl);
  await git.fetch(["--depth", "1", "origin", "HEAD"]);

  // 先看清单再决定拉哪个目录：sparse-checkout 对不存在的路径不会报错，
  // 只会静默给出空目录，必须在 checkout 之前把路径核对好。
  const listing = await git.raw(["ls-tree", "-r", "--name-only", "FETCH_HEAD"]);
  const paths = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const resolved = resolveSkillDir(paths, declared);
  await git.raw(["config", "core.sparseCheckout", "true"]);
  await git.raw(["sparse-checkout", "init", "--cone"]);
  await git.raw(["sparse-checkout", "set", resolved]);
  await git.checkout("FETCH_HEAD");

  const commit = (await git.revparse(["FETCH_HEAD"])).trim();

  return {
    commit,
    contentDir: join(workDir, resolved),
    resolvedSkillPath: `${resolved}/SKILL.md`,
  };
}

/**
 * 只取仓库的文件清单，不 checkout 内容。
 *
 * 给 track 用：skills.sh 只给包名（owner/repo@skill），不给仓库内路径，
 * 而目录名与包名常常不一致 —— 实测 elysiajs/skills@elysiajs 的目录
 * 其实叫 elysia/。靠猜必然失败，必须先看清单。
 */
export async function listUpstreamPaths(
  sourceUrl: string,
  workDir: string
): Promise<string[]> {
  await remove(workDir);
  await ensureDir(workDir);

  const git = simpleGit(workDir);
  await git.init();
  await git.raw(["config", "core.autocrlf", "false"]);
  await git.raw(["config", "core.eol", "lf"]);
  await git.addRemote("origin", sourceUrl);
  await git.fetch(["--depth", "1", "origin", "HEAD"]);

  const listing = await git.raw(["ls-tree", "-r", "--name-only", "FETCH_HEAD"]);
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * 在清单里找含 SKILL.md 的目录。
 *
 * 优先精确匹配目录名，其次唯一的 SKILL.md，最后全部候选。
 */
export function findSkillDirs(paths: string[], preferName?: string): string[] {
  const dirs = paths
    .filter((path) => path.endsWith("SKILL.md"))
    .map((path) =>
      path === "SKILL.md" ? "" : path.slice(0, -"/SKILL.md".length)
    );
  const unique = [...new Set(dirs)];

  if (!preferName) {
    return unique;
  }

  // 目录名与 skill 名一致的排最前
  return unique.sort((a, b) => {
    const nameA = a.split("/").pop() ?? a;
    const nameB = b.split("/").pop() ?? b;
    const scoreA = nameA === preferName ? 0 : 1;
    const scoreB = nameB === preferName ? 0 : 1;
    return scoreA - scoreB || a.length - b.length;
  });
}
