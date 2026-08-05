import { remove } from "@visulima/fs";
import { join } from "@visulima/path";
import { mapDirectoryNormalized } from "./diff";
import { fetchUpstream, findSkillDirs, listUpstreamPaths } from "./fetch";
import { agentsRoot, skillDir } from "./paths";
import { type Candidate, repoUrl, skillsAdd } from "./registry";
import { syncFromLock, writeState } from "./state";
import type { MergeState } from "./types";

/**
 * 候选与本地内容的相似程度。
 *
 * 存在的理由：同名不代表同源。skills.sh 上 shadcn 有 267K 装机量的
 * shadcn/ui@shadcn，也有别人的同名包 —— 记错了之后 agent update 会拿
 * 陌生仓库的内容合并你的文件。所以必须拉下来逐文件比。
 */
export type Verdict =
  /** 逐字节一致 —— 几乎确定是同源，可直接采用 */
  | "identical"
  /** 文件清单基本重合、内容有差异 —— 很可能是同源的不同版本 */
  | "likely"
  /** 有部分重合但差异大 —— 需人判断 */
  | "unsure"
  /** 几乎没有共同文件 —— 大概不是同一个东西 */
  | "unrelated"
  /** 拉不下来（路径不对、仓库私有等） */
  | "unreachable";

export interface Comparison {
  candidate: Candidate;
  /** 只在本地有的 */
  onlyLocal: number;
  /** 只在候选里有的 */
  onlyRemote: number;
  reason?: string;
  /** 两边都有的文件里内容相同的个数 */
  sameFiles: number;
  /** 两边共有的文件数 */
  sharedFiles: number;
  /** 上游仓库内解析出的 SKILL.md 路径，写上游时要用 */
  skillPath?: string;
  verdict: Verdict;
}

function judge(
  shared: number,
  same: number,
  onlyLocal: number,
  onlyRemote: number
): Verdict {
  if (shared === 0) {
    return "unrelated";
  }
  // 全部共有文件都逐字节相同，且两边没有多余文件
  if (same === shared && onlyLocal === 0 && onlyRemote === 0) {
    return "identical";
  }

  const total = shared + onlyLocal + onlyRemote;
  const overlap = shared / total;
  // 文件清单重合度高 —— 同一个 skill 的不同版本通常如此
  if (overlap >= 0.6) {
    return "likely";
  }
  return "unsure";
}

/**
 * 拉取候选并与本地内容比对。
 *
 * 只拉到临时目录，绝不碰本体库。
 */
export async function compareCandidate(
  id: string,
  candidate: Candidate
): Promise<Comparison> {
  const work = join(agentsRoot(), ".track", id);
  const base = {
    candidate,
    onlyLocal: 0,
    onlyRemote: 0,
    sameFiles: 0,
    sharedFiles: 0,
  };

  try {
    // 先看仓库清单再定路径：skills.sh 只给包名，而目录名与包名常常
    // 不一致 —— 实测 elysiajs/skills@elysiajs 的目录其实叫 elysia/。
    const paths = await listUpstreamPaths(repoUrl(candidate), work);
    const dirs = findSkillDirs(paths, candidate.skill);

    if (dirs.length === 0) {
      return {
        ...base,
        reason: "仓库里没有 SKILL.md",
        verdict: "unreachable",
      };
    }

    let contentDir: string | undefined;
    let resolvedPath: string | undefined;
    let lastError = "";

    // 按相关度依次试前几个目录
    for (const dir of dirs.slice(0, 3)) {
      const skillPath = dir === "" ? "SKILL.md" : `${dir}/SKILL.md`;
      try {
        const { contentDir: dir2, resolvedSkillPath } = await fetchUpstream(
          repoUrl(candidate),
          skillPath,
          work
        );
        contentDir = dir2;
        resolvedPath = resolvedSkillPath;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!contentDir) {
      return { ...base, reason: lastError, verdict: "unreachable" };
    }

    // 规范化行尾再比：本机文件多为 CRLF、上游为 LF，
    // 按原始字节比会得出「每个文件都不同」，数字毫无意义。
    const [local, remote] = await Promise.all([
      mapDirectoryNormalized(skillDir(id)),
      mapDirectoryNormalized(contentDir),
    ]);

    let shared = 0;
    let same = 0;
    let onlyLocal = 0;
    for (const [path, hash] of local) {
      const other = remote.get(path);
      if (other === undefined) {
        onlyLocal += 1;
        continue;
      }
      shared += 1;
      if (other === hash) {
        same += 1;
      }
    }
    const onlyRemote = [...remote.keys()].filter(
      (path) => !local.has(path)
    ).length;

    return {
      candidate,
      onlyLocal,
      onlyRemote,
      sameFiles: same,
      sharedFiles: shared,
      verdict: judge(shared, same, onlyLocal, onlyRemote),
      ...(resolvedPath ? { skillPath: resolvedPath } : {}),
    };
  } catch (error) {
    return {
      ...base,
      reason: error instanceof Error ? error.message : String(error),
      verdict: "unreachable",
    };
  } finally {
    await remove(work);
  }
}

/** 比对结果的可读摘要 */
export function describeComparison(comparison: Comparison): string {
  const { onlyLocal, onlyRemote, sameFiles, sharedFiles, verdict } = comparison;

  if (verdict === "unreachable") {
    return `拉取失败：${comparison.reason ?? "未知原因"}`;
  }
  if (verdict === "unrelated") {
    return "没有共同文件";
  }
  if (verdict === "identical") {
    return `逐字节一致（${sharedFiles} 个文件）`;
  }

  const parts = [`${sharedFiles} 个共有文件中 ${sameFiles} 个相同`];
  if (onlyLocal > 0) {
    parts.push(`本地多 ${onlyLocal} 个`);
  }
  if (onlyRemote > 0) {
    parts.push(`上游多 ${onlyRemote} 个`);
  }
  return parts.join("，");
}

/**
 * 逐个比对候选，遇到逐字节一致就提前结束。
 *
 * 每个候选都要 clone 一次，费时；identical 已是确定答案，不必再试。
 */
export async function compareAll(
  id: string,
  candidates: Candidate[],
  limit = 3
): Promise<Comparison[]> {
  const results: Comparison[] = [];

  for (const candidate of candidates.slice(0, limit)) {
    const comparison = await compareCandidate(id, candidate);
    results.push(comparison);
    if (comparison.verdict === "identical") {
      break;
    }
  }

  return results;
}

/**
 * 把选定的候选记为上游。
 *
 * 写我们自己的 .merge-state.json —— ~/.agents/.skill-lock.json 是
 * skills.sh 的文件，本工具一直只读不写。想让 skills 命令也管这个 skill，
 * 用 handoffToSkillsSh 让它自己入账。
 */
export async function recordUpstream(
  id: string,
  comparison: Comparison,
  state?: MergeState
): Promise<MergeState> {
  const current = state ?? (await syncFromLock());
  const existing = current.skills[id];
  const skillPath =
    comparison.skillPath ?? `skills/${comparison.candidate.skill}/SKILL.md`;

  current.skills[id] = {
    base: existing?.base ?? null,
    upstream: {
      // 我们自己认定的来源，不是从 lock 投影来的，
      // 故 lockFolderHash 留空 —— 它只用于察觉 skills.sh 侧的变动。
      lockFolderHash: "",
      skillPath,
      sourceUrl: repoUrl(comparison.candidate),
    },
    ...(existing?.lastCheck ? { lastCheck: existing.lastCheck } : {}),
    ...(existing?.lastMerge ? { lastMerge: existing.lastMerge } : {}),
  };

  await writeState(current);
  return current;
}

/**
 * 让 skills.sh 自己安装并入账。
 *
 * 之后 npx skills list / update 也能看到这个 skill。
 * 注意它会用上游内容覆盖本体库里已有的那份 —— 调用前务必先建
 * git 检查点（见 core/repo.ts），否则本地修改无从恢复。
 */
export async function handoffToSkillsSh(comparison: Comparison): Promise<void> {
  await skillsAdd(comparison.candidate.pkg);
}
