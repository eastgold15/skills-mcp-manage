# agent — skills 作用域管理与三路合并

配合 [skills.sh](https://www.skills.sh/) 使用。它负责下载与本体库，本工具只做它没做的两件事：

1. **作用域管理** —— 批量把本体库的 skill 启用到全局或项目（TUI 多选，不用一个个装）
2. **三路合并** —— 上游更新时，在保留你本地修改的基础上吸收新版本

目前只支持 Claude Code。

## 解决什么问题

| 痛点 | 解法 |
|---|---|
| **来源混乱**：skill 散落各处，`~/.claude/skills` 里混着链接、副本、别的工具建的东西 | `doctor` 把每个条目的真实形态摊开：已纳管 / 外部 / 副本 |
| **作用域不清**：分不清哪些全局通用、哪些项目专用 | `list` 用两列显示每个 skill 在全局与项目的启用状态；`enable`/`disable` 按作用域批量操作 |
| **更新困难**：上游更新时难以保住自己的修改 | 四象限判定 + 文件级三路合并 |

## 安装

```bash
bun install
bun run build      # 产出 dist/index.mjs 并 npm link
```

开发时直接 `bun run src/index.ts <命令>`。

## 命令

```bash
agent list                    # 本体库全景 + 启用状态
agent enable                  # 批量启用（先选作用域，再多选 skill）
agent enable --global         # 直接指定全局，跳过作用域询问
agent disable --project       # 批量卸载
agent update                  # 多选要更新的 skill
agent update codegraph        # 更新单个
agent doctor                  # 诊断作用域目录的真实构成
```

## 目录约定

```
~/.agents/
  .skill-lock.json      skills.sh 的总账 —— 本工具只读，绝不回写
  skills/<id>/          本体库，唯一实体
  .base/<id>/           上次同步的上游快照（本工具建立）
  .merge-state.json     上游投影 + 合并历史（本工具建立）

~/.claude/skills/<id>   → junction 指向 ~/.agents/skills/<id>   全局作用域
./.claude/skills/<id>   → junction 指向 ~/.agents/skills/<id>   项目作用域
```

用 junction 而非 symlink：Windows 下不需要管理员权限或开发者模式，
且 skills.sh 自己用的就是 junction。

**全链接架构**：本体库是唯一实体，作用域侧全是指针。所以

- 改动即改本体，没有"项目副本"，不需要回流
- 同一 skill 在全局与项目都启用时，两边指向同一目录，内容不可能不一致
- 第二个项目启用同一 skill 零成本（不联网、不拷贝）

## 数据流

```
┌─── 上游 GitHub ─────────────────────────────┐
└──────────────────┬──────────────────────────┘
         skills.sh │ install/update    本工具 │ update
                   ▼                          ▼
┌═══ 本体库 ~/.agents/skills/ ════════════════┐
│  skills.sh 写，本工具读                      │
│  + .base/<id>/ 与 .merge-state.json         │
└──┬────────────────────────┬─────────────────┘
   │ junction               │ junction
   ▼                        ▼
~/.claude/skills/       ./.claude/skills/
（全局）                  （项目）
```

### 单向同步与 hash 门控

`.skill-lock.json` → `.merge-state.json` **单向投影**，本工具的改动永不回写。
方向恒定，所以不存在双真理源冲突。

每次启动算一次 lock 的文件哈希：**一致就整个投影跳过，零成本**。
不一致才重新吸取 —— 覆盖 `upstream` 段，保留 `base` 与 `lastMerge` 段。

字段归属（决定谁能改它）：

| 数据 | 真理源 |
|---|---|
| `upstream`（上游地址、monorepo 内路径） | skills.sh 的 lock，单向投影而来 |
| `base`、`lastMerge` | 本工具，lock 同步时原样保留 |
| 作用域启用状态 | **不落盘** —— 文件系统的链接实况就是真理，永不失同步 |

lock 未记录但本体库里存在的 skill（如手动放进去的），
以 `upstream: null` 纳入：**可启用，不可更新**。

lock 里曾有、现已消失的条目标记 `orphaned` 而非删除，
以免丢掉 base 快照与合并历史。

## 三路合并

### 四象限

| | 本地改过 | 上游变过 | 动作 |
|---|---|---|---|
| 1 | 否 | 否 | 无需更新 |
| 2 | 否 | 是 | 快进覆盖 |
| 3 | 是 | 否 | 保留本地，不动 |
| 4 | 是 | 是 | 文件级三路合并 |

两个判定都以 `.base/` 快照为参照系，**不需要 commit**：

- 本地改过？ `skills/<id>/` ≠ `.base/<id>/`
- 上游变过？ 新拉取的 ≠ `.base/<id>/`

三份数据全部来自本体库内部，不跨层：

| 版本 | 来源 |
|---|---|
| base | `~/.agents/.base/<id>/` |
| ours | `~/.agents/skills/<id>/`（工作区） |
| theirs | 临时目录（sparse-checkout 只拉目标子目录） |

存快照而非临时 clone 的好处：离线也能判"改过没"、monorepo 不必反复拉全仓。

### 文件级粒度

逐文件判定。上游改 `SKILL.md`、你改 `references/usage.md` → **自动合并，零冲突**。
只有同一文件的同一处两边都改，才会留下 `<<<<<<<` 标记等你处理。

上游新增的文件会取来，你新增的文件不会被抹掉，
上游删除但你改过的文件会保留并报冲突。

### 首次更新的限制

`.base/` 是本工具引入的，已装的 skill 没有快照。
首次更新某个 skill 时，只能把当前内容当作"上次同步态"来建立基线
—— **本次判不出本地改动（只能走象限 1/2），第二次起才完整可用**。

## 开发

```bash
bun test           # 80 个回归测试
bun run type-check # tsc --noEmit
bun run check      # ultracite
```

测试放 `__test__/`，用 `.test-tmp/` 下各自独立的子目录，互不干扰。
`update.test.ts` 会起真实的本地 git 仓库做端到端验证。

### 技术栈

`@visulima/cerebro` CLI 框架 · `@visulima/fs` 文件 IO · `@visulima/path` 路径
· `@visulima/colorize` 颜色 · `@visulima/tabular` 表格 · `@visulima/error` 抛错
· `@clack/prompts` 交互 · `simple-git` 上游拉取

`@visulima/tui` 已装但未用于主路径 —— 它在非 TTY 环境会因 raw mode 不可用直接崩，
而 clack 能优雅降级。留给后续只在真终端运行的复杂面板。

### 已知环境问题

`core.autocrlf=true` 会让 git checkout 把 LF 转成 CRLF，
使拉下来的内容与本体库逐字节不同，四象限会把每个 skill 都误判为已修改。
拉取时已在临时仓库内强制 `core.autocrlf=false` + `core.eol=lf` 规避。
