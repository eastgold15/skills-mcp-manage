
# Agent Skills & MCP 统一管理 CLI 工具 — 技术设计文档

> 版本：v1.0
> 语言：TypeScript
> 运行时：Bun
> 许可：MIT

---

## 一、项目背景与需求

### 1.1 核心场景

开发者在日常工作中会积累大量来自不同来源的 **AI Agent Skills**（通常为独立 Git 仓库，如 `skill.sh` 生态）以及 **MCP Server** 配置。这些资产需要：

- 统一存放在本地固定的缓存目录（如 `~/.agent/skills`），方便集中管理。
- 每个 Skill 保留完整的 Git 历史，可关联 `upstream`（官方源）和 `origin`（个人 GitHub 仓库）。
- 多个业务项目按需挑选并安装（复制或软链接）所需的 Skill/MCP，项目间隔离。
- 当官方源更新时，能拉取上游代码并与本地定制修改合并，再推送到个人远程仓库。
- 支持创建全新的自定义 Skill，并发布到 GitHub 供团队共享。

### 1.2 痛点与目标

| 痛点 | 目标 |
|------|------|
| 手动管理分散的 Git 仓库，容易丢失 upstream 地址 | 扫描缓存目录，自动识别远程仓库关系 |
| 每个项目重复复制 Skill，占用大量磁盘空间 | 支持软链接（开发环境）与物理复制（生产环境）两种策略 |
| 上游更新后难以与本地修改融合 | 内置 `git pull upstream` + 冲突检测，一键解决 |
| 缺少统一的 CLI 来操作，使用门槛高 | 提供交互式 TUI，兼顾新手与自动化脚本 |

---

## 二、数据流转模型（最终版）

```
[官方源 A (upstream)] ──┐
[官方源 B (upstream)] ──┼── git clone ──▶ [~/.agent/skills/ 本地缓存池]
[官方源 C (upstream)] ──┘                     每个子目录为一个独立 Git 仓库
        │
        │ 扫描缓存池，挑选 Skill A
        ▼
[个人 GitHub (origin)] ◀── git remote add origin + git push ─────────┐
        ▲                                                              │
        │ 安装（复制/软链接）                                          │
        │                                                              │
[项目 X 的 ./skills/A] ────────────────────────────────────────────────┘
        │
        │ (项目内可独立修改，也可提交回个人远程)
        ▼
[项目 Y 的 ./skills/A] ─── 同样的 Skill 可被多个项目引用，互不干扰
```

**关键层次**：

| 层次 | 位置 | 说明 |
|------|------|------|
| **L0 远端源** | GitHub/GitLab | 官方 Skill 仓库或个人 GitHub 仓库 |
| **L1 本地缓存池** | `~/.agent/skills/` | 所有 Skill 的 Git 克隆目录，每个子目录是一个完整的 Git 仓库 |
| **L2 项目安装点** | `./skills/`（项目根目录下） | 通过复制或软链引入 L1 中的 Skill，可保留 `.git` 历史 |

---

## 三、技术选型

| 模块 | 工具库 | 理由 |
|------|--------|------|
| **运行环境** | [Bun](https://bun.sh) v1.0+ | 原生 TypeScript 支持，零配置，编译成单二进制，跨平台 |
| **命令解析** | [boune](https://github.com/ryoppippi/boune) | Bun 原生，TypeScript-first，零依赖，自动补全类型，符合函数式风格 |
| **交互式提示** | [@clack/prompts](https://github.com/natemoo-re/clack) | 极简美观，API 直观，支持选择、输入、密码、多选等 |
| **加载动画** | [ora](https://github.com/sindresorhus/ora) | 经典优雅，与 `@clack/prompts` 配合良好 |
| **彩色输出** | [chalk](https://github.com/chalk/chalk) | 事实标准，功能全面，支持链式调用 |
| **全屏 TUI** | [ink](https://github.com/vadimdemedes/ink) | React 风格的 TUI 框架，被 Claude Code、Gemini CLI 等验证，生态成熟 |
| **Git 操作** | [simple-git](https://github.com/steveukx/git-js) 或 `bun:shell` | 提供稳定的 Git 命令封装，支持 Promise |
| **文件操作** | `fs` / `fs-extra` + `bun:shell` | Bun 自带高效文件 API |
| **差异展示** | [diff](https://github.com/kpdecker/jsdiff) | 用于生成文本差异，结合外部编辑器展示 |

---

## 四、核心架构设计（伪代码）

### 4.1 类型定义（抽象核心实体）

```typescript
// ==============================
// 核心类型
// ==============================

type SkillId = string;
type CachePath = string;           // 如 /home/user/.agent/skills/skill-xyz
type ProjectPath = string;

/** Skill 仓库的远程关系 */
type RemoteRelation = {
  upstream?: string;   // 官方源地址
  origin: string;      // 个人/团队源地址
};

/** Skill 元数据（从缓存中扫描得出） */
type SkillMeta = {
  id: SkillId;
  path: CachePath;
  remotes: RemoteRelation;
  currentBranch: string;
  hasUncommittedChanges: boolean;
  lastCommit: { hash: string; date: Date; message: string };
};

/** 项目安装记录（描述项目引入了哪些 Skill） */
type ProjectSkillEntry = {
  skillId: SkillId;
  installType: 'copy' | 'symlink';
  sourcePath: CachePath;      // 来源
  targetPath: string;         // 相对于项目根目录
  pinnedCommit?: string;      // 若锁定版本，记录 commit hash
};

/** 项目清单文件（如 .agent-deps.json） */
type ProjectManifest = {
  version: 1;
  skills: ProjectSkillEntry[];
  mcps?: McpServerEntry[];     // MCP 相关（略）
};
```

### 4.2 纯函数层（无副作用）

```typescript
// ==============================
// 纯逻辑函数：扫描、过滤、对比
// ==============================

/**
 * 扫描给定目录，发现所有合法的 Skill 仓库
 * 返回 SkillMeta 列表
 */
declare function scanCacheDirectory(
  rootPath: string
): SkillMeta[];

/**
 * 判断一个 Skill 是否与 upstream 有更新
 * 返回落后提交数或 null（若无法比较）
 */
declare function checkUpstreamBehind(
  meta: SkillMeta
): number | null;

/**
 * 根据项目清单，解析出该项目实际需要安装的 Skill 列表
 * 负责处理“条件依赖”和“版本锁定”
 */
declare function resolveProjectSkills(
  manifest: ProjectManifest
): ProjectSkillEntry[];

/**
 * 比较两个 Skill 元数据，判断是否一致（用于增量更新）
 */
declare function isSkillUpToDate(
  local: SkillMeta,
  remote: SkillMeta
): boolean;
```

### 4.3 副作用接口（IO/网络/Git）

```typescript
// ==============================
// 副作用接口（Effect 描述）
// ==============================

type Effect<A> = () => Promise<A>;

/** Git 操作集合 */
type GitEffects = {
  /** 克隆仓库到缓存目录 */
  clone: (url: string, dest: CachePath) => Effect<void>;
  /** 获取上游更新（git fetch upstream） */
  fetchUpstream: (path: CachePath) => Effect<void>;
  /** 合并上游分支（git merge upstream/main） */
  mergeUpstream: (path: CachePath, branch: string) => Effect<{ merged: boolean; conflictFiles: string[] }>;
  /** 推送到 origin（git push origin） */
  pushToOrigin: (path: CachePath) => Effect<void>;
  /** 获取当前 HEAD commit */
  getHeadCommit: (path: CachePath) => Effect<string>;
};

/** 文件系统操作集合 */
type FSEffects = {
  /** 复制目录（保留 .git） */
  copyDir: (src: CachePath, dest: string) => Effect<void>;
  /** 创建软链接 */
  createSymlink: (target: CachePath, linkPath: string) => Effect<void>;
  /** 删除软链接或目录 */
  remove: (path: string) => Effect<void>;
  /** 读取项目清单文件 */
  readManifest: (projectPath: ProjectPath) => Effect<ProjectManifest | null>;
  /** 写入项目清单文件 */
  writeManifest: (projectPath: ProjectPath, manifest: ProjectManifest) => Effect<void>;
};

/** UI 渲染集合（注入 clack/ink） */
type UIEffects = {
  /** 展示选择框 */
  showSelect: <T>(options: { message: string; choices: { label: string; value: T }[] }) => Effect<T>;
  /** 展示多选框 */
  showMultiSelect: <T>(options: { message: string; choices: { label: string; value: T }[] }) => Effect<T[]>;
  /** 展示输入框 */
  showTextInput: (options: { message: string; mask?: boolean }) => Effect<string>;
  /** 展示确认框 */
  showConfirm: (message: string) => Effect<boolean>;
  /** 展示进度条（spinner） */
  showSpinner: <A>(message: string, task: () => Effect<A>) => Effect<A>;
  /** 展示冲突文件列表（树形），返回用户选择的操作 */
  showConflictTree: (conflicts: string[]) => Effect<'open-editor' | 'abort' | 'resolve-all'>;
  /** 显示成功/失败汇总面板 */
  showSummary: (results: Array<{ id: string; status: 'success' | 'conflict' | 'error' }>) => Effect<void>;
};
```

### 4.4 编排层（业务流程组合）

```typescript
// ==============================
// 核心业务流程（纯编排，无副作用）
// ==============================

/**
 * 初始化缓存目录（创建、设置默认配置）
 */
declare function initCache(
  cacheRoot: string,
  deps: { fs: FSEffects; ui: UIEffects }
): Effect<void>;

/**
 * 扫描并展示所有 Skill 清单（交互式浏览）
 */
declare function listSkills(
  cacheRoot: string,
  deps: { fs: FSEffects; git: GitEffects; ui: UIEffects }
): Effect<void>;

/**
 * 为某个 Skill 添加上游远程地址（交互式）
 */
declare function addUpstream(
  skillId: SkillId,
  cacheRoot: string,
  deps: { fs: FSEffects; git: GitEffects; ui: UIEffects }
): Effect<void>;

/**
 * 将本地 Skill 推送到个人 GitHub（自动创建远程仓库需 Token）
 */
declare function publishToGitHub(
  skillId: SkillId,
  cacheRoot: string,
  githubOrg: string,
  deps: { fs: FSEffects; git: GitEffects; ui: UIEffects }
): Effect<void>;

/**
 * 从缓存池安装 Skill 到当前项目
 */
declare function installSkillToProject(
  skillId: SkillId,
  projectPath: ProjectPath,
  installType: 'copy' | 'symlink',
  deps: { fs: FSEffects; git: GitEffects; ui: UIEffects }
): Effect<void>;

/**
 * 同步所有依赖到当前项目（根据项目清单）
 */
declare function syncAll(
  projectPath: ProjectPath,
  cacheRoot: string,
  deps: { fs: FSEffects; git: GitEffects; ui: UIEffects }
): Effect<{ installed: string[]; conflicts: string[] }>;

/**
 * 更新某个 Skill（拉取 upstream 并合并）
 */
declare function updateSkill(
  skillId: SkillId,
  cacheRoot: string,
  deps: { fs: FSEffects; git: GitEffects; ui: UIEffects }
): Effect<{ success: boolean; conflicts: string[] }>;
```

### 4.5 运行时注入与 CLI 入口

```typescript
// ==============================
// CLI 命令定义（boune）
// ==============================

import { defineCli, command, argument, option } from "boune";

const cli = defineCli({
  name: "agent",
  version: "1.0.0",
  commands: {
    init: command({
      description: "初始化 Agent 环境",
      action: async () => {
        const deps = buildRuntimeDependencies();
        await initCache(deps.config.cacheRoot, deps);
      },
    }),
    list: command({
      description: "列出缓存中所有 Skills",
      action: async () => {
        const deps = buildRuntimeDependencies();
        await listSkills(deps.config.cacheRoot, deps);
      },
    }),
    install: command({
      description: "安装 Skill 到当前项目",
      arguments: { skillId: argument.string().required() },
      options: { copy: option.boolean().short("c").description("使用复制而非软链接") },
      action: async ({ args, options }) => {
        const deps = buildRuntimeDependencies();
        const installType = options.copy ? "copy" : "symlink";
        await installSkillToProject(args.skillId, process.cwd(), installType, deps);
      },
    }),
    sync: command({
      description: "同步当前项目的所有依赖",
      action: async () => {
        const deps = buildRuntimeDependencies();
        await syncAll(process.cwd(), deps.config.cacheRoot, deps);
      },
    }),
    update: command({
      description: "更新缓存中的 Skill",
      arguments: { skillId: argument.string().required() },
      action: async ({ args }) => {
        const deps = buildRuntimeDependencies();
        await updateSkill(args.skillId, deps.config.cacheRoot, deps);
      },
    }),
    publish: command({
      description: "将自定义 Skill 发布到 GitHub",
      arguments: { path: argument.string().required() },
      options: { org: option.string().short("o").description("GitHub 组织名") },
      action: async ({ args, options }) => {
        const deps = buildRuntimeDependencies();
        await publishToGitHub(args.path, deps.config.cacheRoot, options.org || "my-org", deps);
      },
    }),
  },
});

// 运行时构建依赖注入
function buildRuntimeDependencies() {
  // 实际将绑定具体库（simple-git, fs-extra, clack, ink 等）
  return {
    config: { cacheRoot: process.env.AGENT_SKILLS_PATH || "~/.agent/skills" },
    fs: /* 实际 fs 实现 */,
    git: /* 实际 simple-git 实现 */,
    ui: /* 实际 clack/ink 实现 */,
  };
}

// 启动 CLI
cli.run(process.argv);
```

---

## 五、CLI UI 功能点清单（最终修正版）

> 按用户操作路径组织，区分 “管理缓存” 与 “管理项目”。

### 5.1 全局初始化与环境配置

| # | 功能 | 交互形式 |
|---|------|----------|
| 1 | 设置缓存根目录（默认 `~/.agent/skills`） | 文本输入 |
| 2 | 配置个人 GitHub 组织/用户名（用于发布） | 文本输入 |
| 3 | 配置 GitHub Token（用于自动创建远程仓库） | 密码输入 |
| 4 | 查看当前全局配置 | 表格输出 |

### 5.2 缓存池管理（本地 Skill 仓库集合）

| # | 功能 | 交互形式 |
|---|------|----------|
| 5 | 扫描缓存目录，列出所有 Skill（含远程关系、分支状态） | 表格（带颜色标识） |
| 6 | 查看 Skill 详细信息（remote URL、最近提交等） | 信息面板 |
| 7 | 为 Skill 添加上游（upstream）远程地址 | 文本输入 + 确认 |
| 8 | 移除缓存的 Skill（删除目录） | 确认框 |
| 9 | 拉取所有缓存 Skill 的上游更新（批量 fetch） | 进度条 + 实时日志 |
| 10 | 拉取单个 Skill 的上游更新并自动合并（若冲突则进入解决流程） | 进度条 + 冲突列表 |

### 5.3 项目级依赖管理

| # | 功能 | 交互形式 |
|---|------|----------|
| 11 | 从缓存池挑选 Skill 安装到当前项目（支持搜索过滤） | 搜索框 + 多选复选框 |
| 12 | 选择安装方式（复制 / 软链接） | 单选框 |
| 13 | 卸载项目中的 Skill（删除副本或链接） | 选择框（选择要卸载的 Skill） |
| 14 | 列出当前项目已安装的 Skill | 表格（含状态） |
| 15 | 对比项目中的 Skill 与缓存中原始版本的差异（若为复制副本） | 调用外部 diff 工具（如 `code --diff`） |

### 5.4 更新与发布（Git 工作流集成）

| # | 功能 | 交互形式 |
|---|------|----------|
| 16 | 检查缓存中哪些 Skill 有上游更新（显示落后提交数） | 列表 + 颜色标识 |
| 17 | 选择并更新特定 Skill（拉取、合并、推送） | 选择框 + 进度条 |
| 18 | 解决合并冲突（显示冲突文件列表，打开外部编辑器） | 树形列表 + 调用 `$EDITOR` |
| 19 | 将修改后的 Skill 推送到个人 GitHub（origin） | 确认框 |
| 20 | 发布全新自定义 Skill（创建本地脚手架 + 初始化 Git + 推送到 GitHub） | 动态表单（名称、描述） |

### 5.5 辅助与自动化

| # | 功能 | 交互形式 |
|---|------|----------|
| 21 | 根据项目清单文件（如 `.agent-deps.json`）一键同步所有依赖 | 进度条（非交互） |
| 22 | 清理未使用的缓存仓库（未被任何项目引用的 Skill） | 多选复选框 + 确认框 |
| 23 | 生成项目依赖清单文件（导出当前项目安装的 Skill 列表） | 确认框（自动生成） |
| 24 | 帮助系统（动态生成命令帮助） | `--help` 输出 |

---

## 六、非功能性需求

- **性能**：扫描 100+ 个 Skill 仓库应在 1 秒内完成（利用 Bun 的文件系统 API）。
- **可靠性**：所有 Git 操作均捕获异常，回滚到安全状态（如合并冲突时退出）。
- **跨平台**：支持 macOS、Linux、Windows（WSL 优先）。
- **扩展性**：新增“工具类型”（如 Linter、Prettier 配置）只需增加对应的 `ArtifactKind` 和同步策略，无需改动核心架构。

---

## 七、发布与分发

- 使用 `bun build --compile` 编译成单文件可执行程序，发布到 GitHub Releases。
- 同时发布 npm 包（`@agent/cli`），支持 `bunx @agent/cli` 或 `npx @agent/cli` 即时使用。
- 内置自动更新检查（可选）。

---

## 八、开发路线图（建议）

| 阶段 | 里程碑 | 预计时间 |
|------|--------|----------|
| Phase 1 | 实现 `scan`、`list`、`install`（软链接）基础功能，交互用 `@clack/prompts` | 2 天 |
| Phase 2 | 实现 Git 操作（`add upstream`, `pull`, `merge`）、冲突检测 | 3 天 |
| Phase 3 | 实现 `sync`、`update`、`publish`，引入 `ink` 全屏 TUI | 3 天 |
| Phase 4 | 增加自动补全、测试、文档、打包发布 | 2 天 |
| **总计** | | **10 工作日** |

---

## 九、附录：冲突处理用户交互流（详细设计）

当 `git merge` 产生冲突时，CLI 交互流程如下：

1. **检测到冲突** → 显示红色警告，列出冲突文件（使用树形列表）。
2. **用户选择**：
   - 选择 “打开编辑器” → 调用 `$EDITOR --wait` 打开第一个冲突文件，等待用户保存退出后，自动检查该文件是否仍含冲突标记，若解决则继续下一个。
   - 选择 “全部使用我们的” → 执行 `git checkout --ours . && git add .`
   - 选择 “全部使用他们的” → 执行 `git checkout --theirs . && git add .`
   - 选择 “中止” → 执行 `git merge --abort`，退出更新流程。
3. 所有冲突解决后，自动 `git commit`（带合并信息）并推送到 origin（需用户确认）。

---
