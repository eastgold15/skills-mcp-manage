# Agent Skills & MCP 统一管理 CLI — 真实设计文档

> 版本：v2.0（修正版）
> 语言：TypeScript
> 运行时：Bun
> 状态：设计定型，可进入开发


## 一、项目背景与真实痛点

### 1.1 我们到底在管理什么？

在使用 AI Agent（如 Cline、Cursor、OpenCode、Claude Code）的过程中，我们会积累两类“能力资产”：

| 类型 | 它到底是什么？ | 实际存储形态 |
|------|---------------|-------------|
| **Skill** | 一个包含提示词、指令、脚本的文件夹（通常含 `SKILL.md`） | 某个 Git 大仓库（Monorepo）的**子目录** |
| **MCP Server** | 一段 JSON 配置：`{ command, args, env }` | **一个 JSON 块**，写入项目的 `.mcp/settings.json` |

**关键发现**：上游作者们**没有统一标准**——有人把单个 Skill 作为一个独立仓库，有人把几十个 Skills 塞进一个 Monorepo；MCP Server 也是一样，有些是独立 npm 包，有些是 Monorepo 里的一个子项目，有些甚至是一个聚合器。

### 1.2 用户真正想要什么？

无论上游怎么组织，用户（你）的诉求始终是：

1. **安装**：把某个 Skill 或 MCP 弄到当前项目里用起来
2. **修改**：根据自己的经验调整它
3. **更新**：上游升级了，能拉下来并融合自己的修改
4. **发布**：把修改后的版本存到自己的 GitHub 组织，供团队共享
5. **多项目隔离**：项目 A 和项目 B 用不同版本，互不干扰

### 1.3 核心矛盾

> **上游把多个能力单元打包在一起，但用户想按单个能力单元来管理。**

用户只想改 `codegraph` 这个 Skill，但它所在的 `dev-skills` 大仓库里还有 `find-skills`、`other-skill` 等十几个 Skill。上游更新时，整个大仓库都变了，用户只关心自己改过的那一个。


## 二、核心解决方案：依赖表（Dependency Table）

**不依赖上游的仓库结构，在用户侧维护一张“依赖表”**，记录每个 Skill/MCP 的完整元数据。

### 2.1 依赖表结构（真实 Schema）

```json
{
  "version": 2,
  "capabilities": {
    "codegraph": {
      "kind": "skill",
      "displayName": "Code Graph Analyzer",
      "source": {
        "type": "git-subdir",
        "repoUrl": "https://github.com/onsager-ai/dev-skills.git",
        "subPath": "skills/codegraph"
      },
      "status": "modified",
      "version": {
        "hash": "a4677e900bdaef77b87cf2f539f9b1bf975aa804",
        "lastUpstreamHash": "7h8d9s2abc..."
      },
      "installPath": "./skills/codegraph",
      "updatedAt": "2026-07-01T10:00:00.000Z"
    },
    "filesystem-mcp": {
      "kind": "mcp",
      "displayName": "Filesystem MCP",
      "source": {
        "type": "registry",
        "registryUrl": "https://github.com/modelcontextprotocol/servers",
        "entryKey": "filesystem"
      },
      "status": "customized",
      "version": {
        "semver": "1.0.0"
      },
      "installPath": "./.mcp/settings.json",
      "config": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
        "env": { "DEBUG": "true" }
      },
      "updatedAt": "2026-07-01T09:30:00.000Z"
    },
    "my-custom-skill": {
      "kind": "skill",
      "source": { "type": "created" },
      "status": "created",
      "installPath": "./skills/my-custom-skill",
      "updatedAt": "2026-07-01T11:00:00.000Z"
    }
  }
}
```

### 2.2 状态机（核心）

```
安装时      本地修改后     执行 publish    推送成功
UPSTREAM ──────────────▶ MODIFIED ──────────────────▶ FORKED
    │                        │                           │
    │ (agent reset)          │ (agent pull)              │
    ▼                        ▼                           ▼
UPSTREAM                 UPSTREAM                   FORKED
(丢失本地改动)           (回退到上游)               (同步后)
```

| 状态 | 含义 | `source.repoUrl` 指向 |
|------|------|----------------------|
| `upstream` | 纯上游代码，未改动 | 官方源 |
| `modified` | 本地有改动，尚未 Fork/推送 | 官方源（未变） |
| `forked` | 已 Fork 到组织，代码已同步 | 组织仓库 |
| `created` | 本地新建的 Skill，未关联远程 | 无 |
| `published` | 新建的 Skill 已推送到组织 | 组织仓库 |


## 三、完整数据流转架构图

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              官方源层 (L0 - Upstream)                                       │
│                                                                                             │
│  Skills 大仓库 (Monorepo)                         MCP 注册表                                │
│  ┌─────────────────────────────┐                ┌─────────────────────────────┐            │
│  │ onsager-ai/dev-skills.git   │                │ modelcontextprotocol/servers │            │
│  │ ├── skills/codegraph/       │                │ ├── filesystem.json         │            │
│  │ ├── skills/find-skills/     │                │ ├── postgres.json           │            │
│  │ └── skills/other/           │                │ └── github.json             │            │
│  ├─────────────────────────────┤                └─────────────────────────────┘            │
│  │ vercel-labs/skills.git      │                                                           │
│  │ └── skills/find-skills/     │                                                           │
│  └─────────────────────────────┘                                                           │
└─────────────────────────────────────┬───────────────────────────────────────────────────────┘
                                      │
              git clone               │  fetch 模板
              (完整 Monorepo)         │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                           本地缓存层 (L1 - ~/.agent/)                                       │
│                                                                                             │
│  Skills 缓存池                             MCP 缓存                                        │
│  ┌─────────────────────────────┐          ┌─────────────────────────────┐                  │
│  │ ~/.agent/skills/            │          │ ~/.agent/mcp/registry/      │                  │
│  │ ├── dev-skills/  (完整仓库) │          │ ├── filesystem.json         │                  │
│  │ │   ├── .git/              │          │ ├── postgres.json           │                  │
│  │ │   └── skills/            │          │ └── github.json             │                  │
│  │ │       ├── codegraph/     │          └─────────────────────────────┘                  │
│  │ │       └── find-skills/   │                                                           │
│  │ ├── skills/    (完整仓库)  │                                                           │
│  │ └── prompts/   (完整仓库)  │                                                           │
│  └─────────────────────────────┘                                                           │
└─────────────────────────────────────┬───────────────────────────────────────────────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              │                                               │
              ▼                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                           项目配置层 (L2 - Project)                                         │
│                                                                                             │
│  项目根目录 /.agent/deps.json  ←── 依赖表（唯一的真理源）                                  │
│                                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐│
│  │ 依赖表记录:                                                                           ││
│  │ • 每个 Skill 的 source (repoUrl + subPath) + status + hash                            ││
│  │ • 每个 MCP 的 source (registryKey) + status + config 覆盖                             ││
│  └─────────────────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────┬───────────────────────────────────────────────────────┘
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            │                                                   │
            ▼                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                           项目运行环境 (L3 - Runtime)                                       │
│                                                                                             │
│  Skills 运行时目录                          MCP 配置                                        │
│  ┌─────────────────────────────┐          ┌─────────────────────────────┐                  │
│  │ ./skills/                   │          │ ./.mcp/settings.json       │                  │
│  │ ├── codegraph/   (子目录)   │          │ {                           │                  │
│  │ │   └── SKILL.md            │          │   "mcpServers": {          │                  │
│  │ ├── find-skills/ (子目录)   │          │     "filesystem": {        │                  │
│  │ └── my-custom/   (新建)     │          │       "command": "npx",    │                  │
│  └─────────────────────────────┘          │       "args": [...]        │                  │
│                                            │     }                       │                  │
│  AI Agent 读取:                           │   }                         │                  │
│  Cline / Cursor / OpenCode                │ }                           │                  │
│                                            └─────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```


## 四、命令设计（用户视角）

### 4.1 命令总览

| 命令 | 作用 | 示例 |
|------|------|------|
| `agent init` | 初始化 `~/.agent/` 目录结构 | `agent init` |
| `agent install` | 安装一个 Skill 或 MCP 到当前项目 | `agent install codegraph` |
| `agent list` | 列出所有已安装的能力单元 | `agent list` |
| `agent status` | 检测哪些文件被修改了 | `agent status` |
| `agent update` | 拉取上游更新，处理冲突 | `agent update codegraph` |
| `agent publish` | 发布修改到 GitHub 组织 | `agent publish --all` |
| `agent create` | 创建新的 Skill | `agent create my-skill` |
| `agent sync` | 根据依赖表同步项目文件 | `agent sync` |
| `agent reset` | 丢弃本地修改，回退到上游 | `agent reset codegraph` |

### 4.2 典型工作流

```bash
# 1. 第一次使用，初始化
agent init

# 2. 安装一个 Skill
agent install codegraph --from https://github.com/onsager-ai/dev-skills.git --path skills/codegraph

# 3. 修改了 ./skills/codegraph/SKILL.md
#    ... 编辑文件 ...

# 4. 查看状态
agent status
# 输出: codegraph (modified) - 检测到本地修改

# 5. 上游更新了，拉取并处理冲突
agent update codegraph
# 自动检测到冲突，打开 VS Code 合并编辑器

# 6. 确认没问题了，发布到组织
agent publish codegraph --org my-skills-mcp

# 7. 其他项目想用这个 Skill（已指向组织）
cd ../project-b
agent install codegraph --from https://github.com/my-skills-mcp/dev-skills.git --path skills/codegraph
```


## 五、冲突处理：只做编排，不做合并

### 5.1 核心原则

> **CLI 只负责检测冲突和准备文件，真正的合并交给 VS Code。**

CLI 不实现任何 diff 算法，不处理 `<<<<<<< HEAD` 标记。它只做三件事：
1. **检测**：通过比对 hash，判断哪些 Skill 有冲突
2. **准备**：提取 base、ours、theirs 三个版本的文件
3. **调用**：`code --wait --merge`，等用户关掉编辑器后再继续

### 5.2 冲突检测流程

```
agent update codegraph

1. 读取依赖表，找到 codegraph 条目
2. 检查 status:
   ├── status == "upstream" → 直接拉取，覆盖项目文件，无需用户介入
   └── status == "modified" → 触发冲突解决流程

冲突解决流程:
3. 提取三个版本:
   - base: 缓存中旧的原始版本 (从 lastUpstreamHash 还原)
   - ours: 当前项目里的修改版本
   - theirs: 刚 pull 下来的上游最新版本
4. 调用 code --wait --merge ours theirs base ours
5. 用户关闭编辑器后，重新计算 hash
6. 更新依赖表
```

### 5.3 用户交互（终端输出）

```bash
$ agent update codegraph

📦 检查更新: onsager-ai/dev-skills
  ├── find-skills  (未修改) ✅ 已自动更新
  └── codegraph    (已修改) ⚠️ 检测到冲突！

─────────────────────────────────────────────
🔄 正在打开 VS Code 合并编辑器...

  本地修改: 修复了提示词逻辑 (hash: a4677e9)
  上游更新: 新增了 Python 支持 (hash: 7h8d9s2)

  请选择操作:
  ❯ 1. 打开 VS Code 手动合并 (推荐)
    2. 全部使用我的版本 (丢弃上游)
    3. 全部使用上游版本 (丢弃我的修改)
    4. 跳过，稍后处理

  → 选择: 1

⏳ 等待 VS Code 关闭...
✅ 冲突已解决 (新 hash: 8f9h2d...)
```


## 六、技术选型（真实且克制）

| 模块 | 工具 | 理由 |
|------|------|------|
| **运行时** | Bun | 原生 TS，编译成单二进制，跨平台 |
| **命令解析** | boune | Bun 原生，类型安全，零依赖 |
| **交互式提示** | @clack/prompts | 简洁美观，覆盖 95% 交互场景 |
| **加载动画** | ora | 经典，稳定 |
| **彩色输出** | chalk | 事实标准 |
| **全屏 TUI** | 暂不引入 | 初期用 @clack 足够，需要全屏时再评估 ink |
| **Git 操作** | simple-git | 稳定、Promise 友好 |
| **文件操作** | fs-extra | 功能全面 |
| **外部编辑器** | child_process.spawn | 调用 `code --wait --merge` |
| **哈希计算** | crypto (内置) | 计算文件夹 SHA1 |


## 七、代码结构（真实目录规划）

```
packages/cli/
├── src/
│   ├── index.ts              # CLI 入口
│   ├── commands/
│   │   ├── init.ts
│   │   ├── install.ts
│   │   ├── list.ts
│   │   ├── status.ts
│   │   ├── update.ts
│   │   ├── publish.ts
│   │   ├── create.ts
│   │   ├── sync.ts
│   │   └── reset.ts
│   ├── core/
│   │   ├── types.ts          # 依赖表类型定义
│   │   ├── manifest.ts       # 依赖表读写
│   │   ├── scanner.ts        # 扫描本地缓存
│   │   └── status-detector.ts # 检测修改状态
│   ├── engines/
│   │   ├── skill-engine.ts   # Skill 安装/更新/发布
│   │   └── mcp-engine.ts     # MCP 安装/更新
│   ├── git/
│   │   ├── repo-manager.ts   # clone/pull/push
│   │   └── remote-manager.ts # upstream/origin 管理
│   ├── github/
│   │   └── api.ts            # GitHub API 调用 (Fork)
│   ├── utils/
│   │   ├── hash.ts           # 计算文件夹 SHA1
│   │   ├── path.ts           # 路径解析
│   │   └── editor.ts         # 调用 VS Code
│   └── ui/
│       ├── prompts.ts        # @clack/prompts 封装
│       ├── colors.ts         # chalk 封装
│       └── spinner.ts        # ora 封装
├── package.json
├── tsconfig.json
└── README.md
```


## 八、发布与分发

- `bun build --compile` 编译成单文件，发布到 GitHub Releases
- 同时发布 npm 包 `@agent/cli`，支持 `bunx @agent/cli`
- GitHub Token 通过 `~/.agent/config.json` 或环境变量 `GITHUB_TOKEN` 配置


## 九、开发路线（5-7 工作日）

| Phase | 内容 | 时间 |
|-------|------|------|
| **Phase 1** | 类型定义 + 依赖表读写 + `list` + `status`（检测 hash） | 1.5 天 |
| **Phase 2** | `install`（git clone + 复制子目录 + 计算 hash）+ `sync` | 1.5 天 |
| **Phase 3** | `update`（git pull + 冲突检测 + 调用 VS Code） | 1.5 天 |
| **Phase 4** | `publish`（GitHub API Fork + git push + 更新依赖表） | 1 天 |
| **Phase 5** | `create` + `reset` + 测试 + 文档 | 1 天 |
| **总计** | | **6.5 天** |


## 十、总结：一句话说清楚这个 CLI

> **这是一个“依赖表管理器”——它不关心上游仓库怎么组织，只维护一张表，记录每个 Skill/MCP 的来源、状态和版本，负责安装、更新、冲突检测和发布。冲突合并交给 VS Code。**