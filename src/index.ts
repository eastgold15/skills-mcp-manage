#!/usr/bin/env bun

import { createCerebro, type Toolbox } from "@visulima/cerebro";
import { errorHandlerPlugin } from "@visulima/cerebro/plugins/error-handler";
import { disable } from "./commands/disable";
import { doctor } from "./commands/doctor";
import { enable } from "./commands/enable";
import { list } from "./commands/list";
import { update } from "./commands/update";
import type { Scope } from "./core/types";
import { PromptCancelled } from "./ui/prompts";

const cli = createCerebro("agent", {
  packageName: "@agent/cli",
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
  examples: ["agent list", "agent list --json"],
  execute: async ({ options }: Toolbox) => {
    await list(process.cwd(), Boolean(options.json));
  },
  name: "list",
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

try {
  await cli.run();
} catch (error) {
  if (error instanceof PromptCancelled) {
    process.exit(130);
  }
  throw error;
}
