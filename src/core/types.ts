/**
 * 数据模型。
 *
 * 字段归属原则（决定谁能改它）：
 *  - upstream 段  → 只由 skills.sh 的 .skill-lock.json 单向投影而来，我们绝不回写
 *  - base/lastMerge 段 → 我们的真理，lock 同步时原样保留
 *  - 作用域启用状态 → 不落盘，每次扫链接实况现推
 */

// ── skills.sh 的 .skill-lock.json（只读） ──────────────────────

/** lock 里单个 skill 的条目 */
export interface LockEntry {
  installedAt: string;
  /** skills.sh 安装时算的内容哈希，与我们自己算的判据不是一回事 */
  skillFolderHash: string;
  /** monorepo 内到 SKILL.md 的路径，如 skills/codegraph/SKILL.md */
  skillPath: string;
  source: string;
  sourceType: string;
  sourceUrl: string;
  updatedAt: string;
}

export interface SkillLock {
  skills: Record<string, LockEntry>;
  version: number;
  [key: string]: unknown;
}

// ── 我们的 .merge-state.json ─────────────────────────────────

/** lock 的投影，单向覆盖。null 表示无上游（lock 未记录），不可更新 */
export interface UpstreamRef {
  /** 投影时 lock 里的值，用于察觉 skills.sh 侧的变动 */
  lockFolderHash: string;
  skillPath: string;
  sourceUrl: string;
}

/** base 快照的元信息，实体在 ~/.agents/.base/<id>/ */
export interface BaseSnapshot {
  /** 我们用 walk 递归算的内容哈希，四象限的判据 */
  contentHash: string;
  syncedAt: string;
  /** 若拉取时能拿到则记录，仅作辅助，不承担正确性 */
  upstreamCommit?: string;
}

export interface MergeRecord {
  at: string;
  /** 需人工介入的文件相对路径 */
  conflicts: string[];
  quadrant: Quadrant;
}

export interface SkillState {
  base: BaseSnapshot | null;
  lastMerge?: MergeRecord;
  /** lock 里曾有、现已消失。不删除，由 doctor 报出 */
  orphaned?: boolean;
  upstream: UpstreamRef | null;
}

export interface MergeState {
  /** 上次投影时 .skill-lock.json 的文件哈希，门控用 */
  lockFileHash: string;
  skills: Record<string, SkillState>;
  syncedFromLockAt: string;
  version: number;
}

// ── 四象限 ───────────────────────────────────────────────────

/**
 * 1: 都没变      → 无需更新
 * 2: 只有上游变  → 快进覆盖
 * 3: 只有本地变  → 保留本地
 * 4: 两边都变    → 三路合并
 */
export type Quadrant = 1 | 2 | 3 | 4;

export interface QuadrantVerdict {
  localChanged: boolean;
  quadrant: Quadrant;
  upstreamChanged: boolean;
}

// ── 作用域 ───────────────────────────────────────────────────

export type Scope = "global" | "project";

/** 一个作用域目录下某个条目的实际形态 */
export type LinkKind =
  /** junction/symlink 指向我们的本体库 */
  | "managed"
  /** junction/symlink 指向别处（如 ~/.skills-manager） */
  | "external"
  /** 真实目录，非链接 —— 拷进来的副本，未纳管 */
  | "directory";

export interface ScopeEntry {
  id: string;
  kind: LinkKind;
  /** 链接指向的目标，kind 为 directory 时为 undefined */
  target?: string;
}

// ── 视图 ─────────────────────────────────────────────────────

/** list 命令的一行 */
export interface SkillView {
  enabledGlobal: boolean;
  enabledProject: boolean;
  id: string;
  orphaned: boolean;
  /** 有上游才能 update */
  updatable: boolean;
}
