---
name: skill-manage
description: 管理本机 Agent Skills 的安装、卸载与上游更新。当用户说「安装/启用某个 skill 到项目或全局」「卸载/移除某个 skill」「更新 skill」「看看有哪些 skill」「skill 冲突了」时使用本工具，而不是手动创建目录或复制文件。
---

# Skill 管理

本机的 skill 由 `agent` CLI 统一管理。**不要手动在 `.claude/skills/` 下建目录或拷文件** —— 那样会绕过链接机制与三路合并，之后无法更新。

## 心智模型

```
~/.agents/skills/<id>     ← 本体（唯一实体，skills.sh 下载到这里）
       ↑ junction              ↑ junction
~/.claude/skills/<id>     ./.claude/skills/<id>
   （全局启用）                （项目启用）
```

- 启用 = 建一个 junction 链接，**不拷贝**。同一个 skill 在 10 个项目启用也只占一份磁盘。
- 因为两个作用域指向同一实体，**不存在"项目版本覆盖全局版本"**，改任何一处就是改本体。
- 卸载 = 删链接，本体库**永不受影响**。
- `~/.agents/.skill-lock.json` 是 skills.sh 的文件，本工具**只读不写**。

## 常用命令

工具在项目根目录，用 `bun run src/index.ts` 调用（或已装好的 `agent` 命令）。

### 查看有哪些 skill

```bash
agent list           # 表格，给人看
agent list --json    # JSON，给你（AI）解析用，优先用这个
```

JSON 每项形如：

```json
{ "id": "codegraph", "updatable": true, "enabledGlobal": false, "enabledProject": true, "orphaned": false }
```

- `updatable: false` 表示 lock 里没有上游记录，只能启用不能更新
- `orphaned: true` 表示 lock 里曾有、现已消失，本体保留未删

### 启用（安装到作用域）

用户说"把 X 装到这个项目"：

```bash
agent enable codegraph -p              # 装到当前项目
agent enable codegraph ast-grep -p     # 一次装多个
agent enable codegraph -g              # 装到全局
```

**给出 ID 时是非交互的，直接执行。** 不带 ID 会进入 TUI 多选界面 —— 你（AI）不要走这条路，会卡在交互上。

`-p` / `--project` 与 `-g` / `--global` 二选一；**都不传时默认项目作用域**（非交互路径）。若用户没说清装到哪，问一句再执行。

### 卸载

用户说"把 X 从项目里移除"：

```bash
agent disable codegraph -p
agent disable codegraph ast-grep -g
```

只删本工具建的链接。遇到外部工具建的链接或手写的真实目录会**拒绝删除并提示**，这是有意的保护。

### 更新（三路合并）

```bash
agent update codegraph    # 更新单个
agent update              # TUI 多选，AI 不要用
```

更新按四象限判定：

| 本地改过 | 上游变了 | 行为 |
|---|---|---|
| 否 | 否 | 无需更新 |
| 否 | 是 | 快进到上游最新 |
| 是 | 否 | 保留本地，什么都不做 |
| 是 | 是 | 逐文件三路合并 |

第四象限里，**上游改 `SKILL.md`、你改 `references/usage.md` 会自动合并、零冲突**；只有同一文件同一处两边都改才需要人介入。

有冲突时：文件里留下 `<<<<<<<` 标记，命令会列出冲突文件路径，且**不推进基线**（下次仍能识别）。此时告知用户哪些文件冲突，可代为编辑解决冲突标记。

首次更新某个已装 skill 会提示"首次接管，已用当前内容建立基线" —— 这次判不出本地修改，第二次起完整可用。

### 诊断

```bash
agent doctor
```

区分作用域目录下三类东西：本工具纳管的链接、外部工具建的链接、真实目录副本。用户抱怨"skill 状态不对"时先跑这个。

## 安装新 skill（本体库还没有的）

本工具**不负责从网上下载**。本体库为空或用户要装一个本地没有的 skill 时，用 skills.sh 的 CLI 下载到 `~/.agents/skills/`，再用 `agent enable` 启用。skill 目录也可以手动放到 `~/.agents/skills/<id>/`（含 `SKILL.md`），本工具会自动纳管，只是没有上游因而不可更新。

## 边界

- 目前只支持 Claude Code（`.claude/skills/`）
- 不写 `.skill-lock.json`
- 不删非本工具建立的东西
