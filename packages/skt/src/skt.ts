#!/usr/bin/env bun

import { createCerebro, type Toolbox } from "@visulima/cerebro";
import { errorHandlerPlugin } from "@visulima/cerebro/plugins/error-handler";
import { check } from "./commands/check";
import { showConfig } from "./commands/config";
import { diff } from "./commands/diff";
import { disable } from "./commands/disable";
import { doctor } from "./commands/doctor";
import { enable } from "./commands/enable";
import { list } from "./commands/list";
import { remove } from "./commands/remove";
import { repo } from "./commands/repo";
import { scan } from "./commands/scan";
import { track } from "./commands/track";
import { update } from "./commands/update";
import type { Scope } from "./core/types";

export const cli = createCerebro("skt", {
  packageName: "@eastgold15/skt",
  packageVersion: "2.0.0",
});

// 用法类错误只显示一行提示，不打印源码框与堆栈；
// 意料之外的错误保留完整信息便于排查。
const CONCISE_ERRORS = new Set(["PromptCancelled", "MissingArgument"]);

cli.addPlugin(
  errorHandlerPlugin({
    concise: (error) => CONCISE_ERRORS.has(error.name),
    detailed: false,
  })
);

/** 把 --global / --project 归一成作用域；都没给则由命令自己询问 */
function pickScope(options: Record<string, unknown>): Scope | undefined {
  if (options.global) {
    return "global";
  }
  if (options.project) {
    return "project";
  }
}

const SCOPE_OPTIONS = [
  {
    alias: "g",
    description: "作用于全局 (~/.claude/skills)",
    name: "global",
    type: Boolean,
  },
  {
    alias: "p",
    description: "作用于当前项目 (./.claude/skills)",
    name: "project",
    type: Boolean,
  },
];

cli.addCommand({
  alias: "ls",
  description: "列出本体库全部 skill 及其启用状态",
  examples: ["agent list", "agent list --json", "agent list --all"],
  execute: async ({ options }: Toolbox) => {
    await list(process.cwd(), Boolean(options.json), Boolean(options.all));
  },
  name: "list",
  options: [
    {
      alias: "a",
      description: "连已失联的记录一起显示",
      name: "all",
      type: Boolean,
    },
    {
      description: "输出 JSON，便于脚本与 AI 解析",
      name: "json",
      type: Boolean,
    },
  ],
});

cli.addCommand({
  argument: {
    description: "skill ID，可传多个；省略则进入 TUI 多选",
    name: "ids",
    type: String,
  },
  description: "批量启用 skill 到全局或项目（传 ID 则非交互）",
  examples: [
    "agent enable",
    "agent enable --global",
    "agent enable codegraph ast-grep -p",
  ],
  execute: async ({ argument, options }: Toolbox) => {
    await enable(process.cwd(), pickScope(options), argument);
  },
  name: "enable",
  options: SCOPE_OPTIONS,
});

cli.addCommand({
  argument: {
    description: "skill ID，可传多个；省略则进入 TUI 多选",
    name: "ids",
    type: String,
  },
  description: "批量卸载 skill（只删本工具建立的链接，本体库不动）",
  examples: [
    "agent disable",
    "agent disable --global",
    "agent disable codegraph -p",
  ],
  execute: async ({ argument, options }: Toolbox) => {
    await disable(process.cwd(), pickScope(options), argument);
  },
  name: "disable",
  options: SCOPE_OPTIONS,
});

cli.addCommand({
  argument: {
    description: "skill ID，可传多个；省略则检查全部有上游的",
    name: "ids",
    type: String,
  },
  description: "联网检查上游有无新版本（只看不动），结果记入 state 供 ls 显示",
  examples: ["agent check", "agent check codegraph", "agent check --json"],
  execute: async ({ argument, options }: Toolbox) => {
    await check({ asJson: Boolean(options.json), ids: argument });
  },
  name: "check",
  options: [
    {
      description: "输出 JSON，便于脚本与 AI 解析",
      name: "json",
      type: Boolean,
    },
  ],
});

cli.addCommand({
  argument: {
    description: "skill ID，省略则进入多选",
    name: "id",
    type: String,
  },
  description: "从上游更新 skill，必要时三路合并（不传 id 则 TUI 多选）",
  examples: ["agent update", "agent update codegraph"],
  execute: async ({ argument }: Toolbox) => {
    await update(argument[0]);
  },
  name: "update",
});

cli.addCommand({
  description: "诊断作用域目录：哪些已纳管、哪些是外部链接、哪些是副本",
  execute: async () => {
    await doctor(process.cwd());
  },
  name: "doctor",
});

cli.addCommand({
  argument: {
    description: "指定扫描位置，可传多个；省略则用配置里的 roots",
    name: "roots",
    type: String,
  },
  description: "按配置扫描磁盘上的 skill；--normalize 收编到本体库",
  examples: [
    "agent scan",
    "agent scan L:/Documents/GitHub",
    "agent scan --reuse",
    "agent scan --normalize",
    "agent scan --normalize --apply",
  ],
  execute: async ({ argument, options }: Toolbox) => {
    await scan({
      apply: Boolean(options.apply),
      asJson: Boolean(options.json),
      normalize: Boolean(options.normalize),
      reuse: Boolean(options.reuse),
      roots: argument,
    });
  },
  name: "scan",
  options: [
    {
      alias: "n",
      description: "把本体库外的 skill 复制进本体库，原位置换成链接",
      name: "normalize",
      type: Boolean,
    },
    {
      description: "真正执行归一化（不加则只预演，不动任何文件）",
      name: "apply",
      type: Boolean,
    },
    {
      alias: "r",
      description: "用上次的扫描结果重新判定，不重扫磁盘（改完配置后用）",
      name: "reuse",
      type: Boolean,
    },
    {
      description: "输出 JSON，便于脚本与 AI 解析",
      name: "json",
      type: Boolean,
    },
  ],
});

cli.addCommand({
  description: "显示扫描策略配置的位置与内容（include/exclude 由你手工维护）",
  execute: async () => {
    await showConfig();
  },
  name: "config",
});

cli.addCommand({
  argument: {
    description: "skill ID，可传多个；省略则处理全部无上游的",
    name: "ids",
    type: String,
  },
  description: "为无上游的 skill 搜索并记录上游（拉取候选对比内容后确认）",
  examples: [
    "agent track",
    "agent track shadcn",
    "agent track --list",
    "agent track --yes --handoff",
  ],
  execute: async ({ argument, options }: Toolbox) => {
    await track({
      autoIdentical: Boolean(options.yes),
      handoff: Boolean(options.handoff),
      ids: argument,
      listOnly: Boolean(options.list),
    });
  },
  name: "track",
  options: [
    {
      alias: "l",
      description: "只列出候选与比对结果，不记录任何上游",
      name: "list",
      type: Boolean,
    },
    {
      alias: "y",
      description: "逐字节一致的直接采用，不逐个询问",
      name: "yes",
      type: Boolean,
    },
    {
      description:
        "记上游后调 skills add 让 skills.sh 也入账（会用上游内容覆盖本地，已自动建 git 检查点）",
      name: "handoff",
      type: Boolean,
    },
  ],
});

cli.addCommand({
  description: "本体库的版本管理：初始化 git、查看改动、提交检查点",
  examples: [
    "agent repo",
    "agent repo --log",
    'agent repo --commit "手工调整了 shadcn"',
  ],
  execute: async ({ options }: Toolbox) => {
    await repo({
      ...(typeof options.commit === "string" ? { commit: options.commit } : {}),
      log: Boolean(options.log),
    });
  },
  name: "repo",
  options: [
    {
      description: "把当前改动提交为检查点，需给出说明",
      name: "commit",
      type: String,
    },
    {
      description: "显示最近 10 条提交",
      name: "log",
      type: Boolean,
    },
  ],
});

cli.addCommand({
  argument: {
    description: "skill ID，可传多个；省略则进入 TUI 多选",
    name: "ids",
    type: String,
  },
  description:
    "从本体库彻底删除 skill（连带摘链接、清快照、同步 skills.sh）。只想停用请用 disable",
  examples: [
    "agent remove",
    "agent remove old-skill another-one",
    "agent remove old-skill --force",
    "agent remove old-skill --no-sync",
  ],
  execute: async ({ argument, options }: Toolbox) => {
    await remove(process.cwd(), {
      force: Boolean(options.force),
      ids: argument,
      noSync: Boolean(options.noSync),
    });
  },
  name: "remove",
  options: [
    {
      alias: "f",
      description: "跳过确认",
      name: "force",
      type: Boolean,
    },
    {
      description: "不通知 skills.sh，只打印待执行的命令",
      name: "no-sync",
      type: Boolean,
    },
  ],
});

cli.addCommand({
  argument: {
    description: "只处理这个 skill ID",
    name: "id",
    type: String,
  },
  description: "逐个比对与本体库同名但内容不同的 skill，决定保留哪份",
  examples: ["agent diff", "agent diff --list", "agent diff find-skills"],
  execute: async ({ argument, options }: Toolbox) => {
    await diff({ listOnly: Boolean(options.list), only: argument[0] });
  },
  name: "diff",
  options: [
    {
      alias: "l",
      description: "只列出差异清单，不进入逐个处理",
      name: "list",
      type: Boolean,
    },
  ],
});
