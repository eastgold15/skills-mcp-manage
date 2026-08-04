#!/usr/bin/env bun

import { createCerebro, type Toolbox } from "@visulima/cerebro";
import { errorHandlerPlugin } from "@visulima/cerebro/plugins/error-handler";
import { create } from "./commands/create";
import { init } from "./commands/init";
import { install } from "./commands/install";
import { list } from "./commands/list";
import { publish } from "./commands/publish";
import { remove } from "./commands/remove";
import { reset } from "./commands/reset";
import { status } from "./commands/status";
import { sync } from "./commands/sync";
import { update } from "./commands/update";
import { getContext } from "./core/context";
import { requireArgument } from "./utils/args";

const cli = createCerebro("agent", {
  packageName: "@agent/cli",
  packageVersion: "2.0.0",
});

// 用法类错误（缺参、来源格式不对、找不到能力）只显示一行提示，
// 不打印源码框与堆栈；意料之外的错误仍保留完整信息便于排查。
const CONCISE_ERROR_NAMES = new Set([
  "MissingArgument",
  "InvalidSourceFormat",
  "CapabilityNotFound",
  "MCP_NOT_FOUND",
]);

cli.addPlugin(
  errorHandlerPlugin({
    concise: (error) => CONCISE_ERROR_NAMES.has(error.name),
    detailed: false,
  })
);

cli.addCommand({
  description: "初始化 agent 项目",
  execute: async () => {
    const { projectPath } = await getContext();
    await init(projectPath);
  },
  name: "init",
});

cli.addCommand({
  argument: {
    description:
      "能力来源，如 git:<url>、git-subdir:<url>::<子路径>、registry:<url>::<键>",
    name: "source",
    type: String,
  },
  description: "安装技能或 MCP（registry: 前缀走 MCP，其余走技能）",
  examples: [
    "agent install git:https://github.com/org/repo",
    "agent install git-subdir:https://github.com/org/repo::skills/foo --name foo",
  ],
  execute: async ({ argument, options }: Toolbox) => {
    const { projectPath, skillEngine, mcpEngine } = await getContext();
    await install(
      projectPath,
      requireArgument(argument, 0, "source"),
      { mcpEngine, skillEngine },
      {
        name: options.name as string | undefined,
        path: options.path as string | undefined,
      }
    );
  },
  name: "install",
  options: [
    { alias: "n", description: "自定义能力名称", name: "name", type: String },
    { alias: "p", description: "自定义安装路径", name: "path", type: String },
  ],
});

cli.addCommand({
  alias: "ls",
  description: "列出已安装的全部能力",
  execute: async () => {
    const { projectPath, skillEngine } = await getContext();
    await list(projectPath, skillEngine);
  },
  name: "list",
});

cli.addCommand({
  description: "查看已安装能力的状态",
  execute: async () => {
    const { projectPath, skillEngine } = await getContext();
    await status(projectPath, skillEngine);
  },
  name: "status",
});

cli.addCommand({
  argument: { description: "能力 ID", name: "id", type: String },
  description: "从上游更新指定能力",
  execute: async ({ argument }: Toolbox) => {
    const { projectPath, skillEngine } = await getContext();
    await update(projectPath, requireArgument(argument, 0, "id"), skillEngine);
  },
  name: "update",
});

cli.addCommand({
  argument: { description: "能力 ID", name: "id", type: String },
  description: "发布已修改或新建的能力",
  execute: async ({ argument }: Toolbox) => {
    const { projectPath, skillEngine } = await getContext();
    await publish(projectPath, requireArgument(argument, 0, "id"), skillEngine);
  },
  name: "publish",
});

cli.addCommand({
  argument: { description: "技能名称", name: "name", type: String },
  description: "新建自定义技能",
  execute: async ({ argument }: Toolbox) => {
    const { projectPath, skillEngine } = await getContext();
    await create(
      projectPath,
      requireArgument(argument, 0, "name"),
      skillEngine
    );
  },
  name: "create",
});

cli.addCommand({
  description: "同步全部能力与上游",
  execute: async () => {
    const { projectPath, skillEngine } = await getContext();
    await sync(projectPath, skillEngine);
  },
  name: "sync",
});

cli.addCommand({
  argument: { description: "能力 ID", name: "id", type: String },
  description: "将能力重置到上游版本",
  execute: async ({ argument }: Toolbox) => {
    const { projectPath, skillEngine } = await getContext();
    await reset(projectPath, requireArgument(argument, 0, "id"), skillEngine);
  },
  name: "reset",
});

cli.addCommand({
  alias: "rm",
  argument: { description: "能力 ID", name: "id", type: String },
  description: "移除指定能力",
  execute: async ({ argument }: Toolbox) => {
    const { projectPath, skillEngine } = await getContext();
    await remove(projectPath, requireArgument(argument, 0, "id"), skillEngine);
  },
  name: "remove",
});

await cli.run();
