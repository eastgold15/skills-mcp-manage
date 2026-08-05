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

/**
 * 一次联网检查的结果。
 *
 * 必须落盘：判断「上游有没有新版本」只能靠拉取对比，本地无从推导 ——
 * lockFolderHash 是 skills.sh 安装时算的，不随上游变化。
 * 所以 ls 显示的是上次 check 的结论，可能过时，由 checkedAt 交代。
 */
export interface CheckRecord {
  /** 检查时刻 */
  at: string;
  /** 拉到的上游 commit，便于察觉后续变动 */
  commit?: string;
  /** 本地相对 base 有改动 */
  localChanged: boolean;
  /** 上游相对 base 有改动 —— 这才是「可以更新」 */
  upstreamChanged: boolean;
}

export interface SkillState {
  base: BaseSnapshot | null;
  /** 上次 agent check 的结果 */
  lastCheck?: CheckRecord;
  lastMerge?: MergeRecord;
  /** lock 里曾有、现已消失。不删除，由 doctor 报出 */
  orphaned?: boolean;
  upstream: UpstreamRef | null;
}

export interface MergeState {
  /**
   * 上次投影时本体库的目录清单，门控用。
   * 老版本文件里没有这个字段，读作空数组即触发重新投影，自愈。
   */
  libraryIds?: string[];
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

/**
 * 一个 skill 的同步状态。
 *
 * 与「有没有上游」分开：有上游只是**能**执行 update，
 * 至于上游此刻有没有新版本，得联网 check 才知道。
 */
export type SyncStatus =
  /** 没有上游，谈不上同步 */
  | "no-upstream"
  /** 有上游但从未 check / update 过，不知道状态 */
  | "unknown"
  /** 上次检查时两边都没变 */
  | "up-to-date"
  /** 上游有新内容可取 */
  | "behind"
  /** 只有本地改过，上游没动 */
  | "local-only"
  /** 上游有新内容且本地也改过，update 会三路合并 */
  | "diverged"
  /** 上次合并留下未解决的冲突 */
  | "conflicted";

/** list 命令的一行 */
export interface SkillView {
  /** 上次 check 或 update 的时刻，用于交代状态的新鲜度 */
  checkedAt?: string;
  /** 上次合并遗留的冲突文件数 */
  conflicts: number;
  enabledGlobal: boolean;
  enabledProject: boolean;
  id: string;
  orphaned: boolean;
  status: SyncStatus;
  /** lock 里有上游记录 —— 能执行 update，不代表有新版本 */
  tracked: boolean;
}

// ── 扫描注册表 ───────────────────────────────────────────────

/**
 * 扫描策略，落在 ~/.agents/.skill-scan.json，由用户手工维护。
 *
 * 存在的理由：磁盘上带 SKILL.md 的目录成千上万，绝大多数是第三方
 * 工具的内置资源。「哪些算我的 skill」是用户的偏好，代码猜不了 ——
 * 硬编码白名单要么漏（放进第三方内置）要么误杀（漏掉真想管的位置）。
 * 交给 glob 配置，规则可读、可审计、可版本化。
 */
export interface ScanConfig {
  /** 排除的 glob，优先级高于 include */
  exclude: string[];
  /** 命中即视为「用户的 skill」，只有这些才允许归一化 */
  include: string[];
  /** 全盘扫描的起点 */
  roots: string[];
  version: number;
}

/**
 * 扫到的一个 skill 位置。
 *
 * 同一个 id 可能在多处出现（本体库一份、项目里一份副本），
 * 因此这里是「位置」的清单而非「skill」的清单。
 */
export interface ScanHit {
  /**
   * 是否命中配置的 include 且未被 exclude 挡掉。
   * 只有 true 才允许归一化 —— 判定完全由 ~/.agents/.skill-scan.json 决定。
   */
  adoptable: boolean;
  id: string;
  /** 是本体库内的（~/.agents/skills/<id>） */
  inLibrary: boolean;
  /** 是链接而非真实目录 */
  isLink: boolean;
  /** skill 目录的绝对路径 */
  path: string;
  /** 链接目标，isLink 为 false 时 undefined */
  target?: string;
}

/**
 * 扫描结果缓存，落在 ~/.agents/.scan-cache.json。
 *
 * 存在的意义就是让 ls 不必每次全盘扫 —— 全盘扫一次要走遍磁盘，
 * 实测 80 秒；读这个 JSON 是毫秒级。数据可能过时，靠 scan 刷新。
 */
export interface ScanCache {
  hits: ScanHit[];
  /** 本次扫描覆盖的根目录，便于判断缓存的适用范围 */
  roots: string[];
  scannedAt: string;
  version: number;
}
