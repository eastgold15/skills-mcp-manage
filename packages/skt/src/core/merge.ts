import { copy, ensureDir, isAccessible, readFile, remove } from "@visulima/fs";
import { dirname, join } from "@visulima/path";
import simpleGit from "simple-git";
import type { FileMap } from "./diff";
import { decideFiles, type FileVerdict } from "./diff";

export interface ApplyPlan {
  /** 上游已删但本地改过，需人决定 */
  deleteConflicts: string[];
  /** 要删除的文件 */
  deletions: string[];
  /** 保留 ours 的文件（无需动作，仅供展示） */
  keepOurs: string[];
  /** 需要三路合并的文件 */
  merges: string[];
  /** 从 theirs 取的文件 */
  takeTheirs: string[];
}

/** 判定 → 归入 ApplyPlan 的哪个动作列表；unchanged 不在表里，无需动作 */
const VERDICT_BUCKET: Partial<Record<FileVerdict, keyof ApplyPlan>> = {
  "added-local": "keepOurs",
  "added-upstream": "takeTheirs",
  conflict: "merges",
  "delete-conflict": "deleteConflicts",
  "deleted-upstream": "deletions",
  "keep-ours": "keepOurs",
  "take-theirs": "takeTheirs",
};

export function buildPlan(verdicts: Map<string, FileVerdict>): ApplyPlan {
  const plan: ApplyPlan = {
    deleteConflicts: [],
    deletions: [],
    keepOurs: [],
    merges: [],
    takeTheirs: [],
  };

  for (const [path, verdict] of verdicts) {
    const bucket = VERDICT_BUCKET[verdict];
    if (bucket) {
      plan[bucket].push(path);
    }
  }

  return plan;
}

export interface MergeFileOutcome {
  /** true 表示自动合并成功，false 表示留下了冲突标记 */
  clean: boolean;
  path: string;
}

/**
 * 覆盖式拷贝单个文件。
 *
 * 不用 copy 的 overwrite 选项：它在目标已存在时仍报 EEXIST
 * （overwrite 被映射为 force，但缺 recursive 时对单文件不生效）。
 * 先删后拷语义明确，跨平台可靠。
 */
async function copyOver(from: string, to: string): Promise<void> {
  await ensureDir(dirname(to));
  await remove(to);
  await copy(from, to);
}

/** 冲突标记，git merge-file 写入的 */
const CONFLICT_MARKER = "<<<<<<<";

/**
 * 对单个文件做三路合并。
 *
 * 用 git merge-file：无需外部编辑器，无界面环境也能跑。
 * 冲突时在文件里留 <<<<<<< 标记，由用户自行处理。
 *
 * 冲突判定读回文件查标记，而非依赖退出码/异常 ——
 * merge-file 冲突时以 1 退出但仍写入结果，各 git 封装对此的处理不一致。
 */
async function mergeOneFile(
  oursPath: string,
  basePath: string,
  theirsPath: string
): Promise<boolean> {
  const git = simpleGit();
  try {
    await git.raw([
      "merge-file",
      "-L",
      "ours",
      "-L",
      "base",
      "-L",
      "theirs",
      oursPath,
      basePath,
      theirsPath,
    ]);
  } catch {
    // 有冲突时以非零退出，结果已写入，继续往下读文件确认
  }

  const merged = (await readFile(oursPath)) as string;
  return !merged.includes(CONFLICT_MARKER);
}

export interface ApplyResult {
  /** 实际留下冲突标记的文件 */
  conflicted: string[];
  plan: ApplyPlan;
}

/**
 * 把合并计划落到本体库（ours 所在目录）。
 *
 * 全链接架构下 ours 就是本体库工作区，改它即改所有作用域看到的内容。
 */
export async function applyPlan(
  plan: ApplyPlan,
  dirs: { base: string; ours: string; theirs: string }
): Promise<ApplyResult> {
  const conflicted: string[] = [];

  for (const path of plan.takeTheirs) {
    await copyOver(join(dirs.theirs, path), join(dirs.ours, path));
  }

  for (const path of plan.deletions) {
    await remove(join(dirs.ours, path));
  }

  for (const path of plan.merges) {
    const ours = join(dirs.ours, path);
    const base = join(dirs.base, path);
    const theirs = join(dirs.theirs, path);

    if (!((await isAccessible(base)) && (await isAccessible(theirs)))) {
      conflicted.push(path);
      continue;
    }

    const clean = await mergeOneFile(ours, base, theirs);
    if (!clean) {
      conflicted.push(path);
    }
  }

  // 上游删除但本地改过：保留本地文件不动，只报告让用户决定
  conflicted.push(...plan.deleteConflicts);

  return { conflicted, plan };
}

/** 判定 + 建计划 + 落盘，一步到位 */
export async function mergeDirectories(
  maps: { base: FileMap; ours: FileMap; theirs: FileMap },
  dirs: { base: string; ours: string; theirs: string }
): Promise<ApplyResult> {
  const verdicts = decideFiles(maps.base, maps.ours, maps.theirs);
  const plan = buildPlan(verdicts);
  return await applyPlan(plan, dirs);
}

/** 同步 base 快照到指定内容目录 */
export async function snapshotBase(
  contentDir: string,
  baseTarget: string
): Promise<void> {
  await remove(baseTarget);
  await ensureDir(dirname(baseTarget));
  await copy(contentDir, baseTarget);
}
