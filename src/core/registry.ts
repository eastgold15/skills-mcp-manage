import { spawn } from "node:child_process";

/**
 * 调 skills.sh 的 CLI 搜索上游。
 *
 * 为什么必须搜：本地 skill 的 frontmatter 只有 name/description，
 * 没有任何来源字段；那些项目里也没有 .skill-lock.json（不是 skills.sh
 * 装的）。所以上游地址无从读取，只能按名字去它的索引里找。
 */

export interface Candidate {
  /** 安装量，用于排序参考 */
  installs: string;
  /** GitHub owner */
  owner: string;
  /** 完整包名 owner/repo@skill，可直接喂给 skills add */
  pkg: string;
  repo: string;
  /** skill 在包内的名字 */
  skill: string;
  url: string;
}

/** 剥掉 ANSI 色码 */
function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 就是要匹配控制字符
  return text.replace(/\[[0-9;]*m/g, "");
}

/** owner/repo@skill 加安装量 */
const ENTRY = /^(\S+?)\/(\S+?)@(\S+)\s+(.+?)\s+installs?$/;
const URL_LINE = /^└\s+(https?:\/\/\S+)$/;

/**
 * 解析 skills find 的输出。
 *
 * 格式（去掉色码后）：
 *   owner/repo@skill   12.3K installs
 *   └ https://skills.sh/owner/repo/skill
 */
export function parseFindOutput(raw: string): Candidate[] {
  const lines = stripAnsi(raw)
    .split("\n")
    .map((line) => line.trim());
  const found: Candidate[] = [];

  for (const [index, line] of lines.entries()) {
    const match = ENTRY.exec(line);
    if (!match) {
      continue;
    }
    const [, owner, repo, skill, installs] = match;
    const urlMatch = URL_LINE.exec(lines[index + 1] ?? "");

    found.push({
      installs: installs as string,
      owner: owner as string,
      pkg: `${owner}/${repo}@${skill}`,
      repo: repo as string,
      skill: skill as string,
      url: urlMatch?.[1] ?? `https://skills.sh/${owner}/${repo}/${skill}`,
    });
  }

  return found;
}

/** 由包名推出 git 仓库地址 */
export function repoUrl(candidate: Candidate): string {
  return `https://github.com/${candidate.owner}/${candidate.repo}.git`;
}

function runSkills(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // npx 而非全局 skills：这台机器上没装全局命令，npx 会自动取
    const child = spawn("npx", ["skills", ...args], { shell: true });
    let out = "";
    let err = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`skills ${args.join(" ")} 超时`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(out);
        return;
      }
      reject(new Error(err.trim() || `skills 退出码 ${code}`));
    });
  });
}

/**
 * 搜索某个 skill 名字的候选上游。
 *
 * 结果按 skills.sh 的排序（安装量降序）返回，不做取舍 ——
 * 同名不代表同源，选哪个必须由人或内容比对来定。
 */
export async function findCandidates(
  name: string,
  timeoutMs = 60_000
): Promise<Candidate[]> {
  const raw = await runSkills(["find", name], timeoutMs);
  const all = parseFindOutput(raw);

  // skill 名完全相同的排前面 —— 最可能是同一个东西
  return all.sort((a, b) => {
    const exactA = a.skill === name ? 0 : 1;
    const exactB = b.skill === name ? 0 : 1;
    return exactA - exactB;
  });
}

/** 让 skills.sh 自己安装并入账，之后 skills 命令也能管这个 skill */
export async function skillsAdd(
  pkg: string,
  timeoutMs = 120_000
): Promise<void> {
  await runSkills(["add", pkg, "--global", "--yes"], timeoutMs);
}

/**
 * 让 skills.sh 把这些 skill 从账上去掉。
 *
 * 不同步的后果：npx skills list 仍列出已删的 skill，而且
 * .skill-lock.json 里的残留记录会在下次 syncFromLock 时被重新投影，
 * 在 ls 里显示成 orphaned。
 */
export async function skillsRemove(
  ids: string[],
  timeoutMs = 120_000
): Promise<void> {
  await runSkills(["remove", ...ids, "--global", "--yes"], timeoutMs);
}
