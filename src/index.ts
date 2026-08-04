#!/usr/bin/env bun

import { createCerebro, type Toolbox } from '@visulima/cerebro';
import { errorHandlerPlugin } from '@visulima/cerebro/plugins/error-handler';
import { create } from './commands/create';
import { init } from './commands/init';
import { install } from './commands/install';
import { list } from './commands/list';
import { publish } from './commands/publish';
import { remove } from './commands/remove';
import { reset } from './commands/reset';
import { status } from './commands/status';
import { sync } from './commands/sync';
import { update } from './commands/update';
import { getContext } from './core/context';
import { requireArgument } from './utils/args';

const cli = createCerebro('agent', {
  packageName: '@agent/cli',
  packageVersion: '2.0.0',
});

cli.addPlugin(errorHandlerPlugin({ detailed: false }));

cli.addCommand({
  name: 'init',
  description: '初始化 agent 项目',
  execute: async () => {
    const { projectPath } = await getContext();
    await init(projectPath);
  },
});

cli.addCommand({
  name: 'install',
  description: '安装技能或 MCP（registry: 前缀走 MCP，其余走技能）',
  argument: {
    name: 'source',
    description:
      '能力来源，如 git:<url>、git-subdir:<url>::<子路径>、registry:<url>::<键>',
    type: String,
  },
  options: [
    { name: 'name', alias: 'n', description: '自定义能力名称', type: String },
    { name: 'path', alias: 'p', description: '自定义安装路径', type: String },
  ],
  examples: [
    'agent install git:https://github.com/org/repo',
    'agent install git-subdir:https://github.com/org/repo::skills/foo --name foo',
  ],
  execute: async ({ argument, options }: Toolbox) => {
    const { projectPath, skillEngine, mcpEngine } = await getContext();
    await install(
      projectPath,
      requireArgument(argument, 0, 'source'),
      { skillEngine, mcpEngine },
      {
        name: options.name as string | undefined,
        path: options.path as string | undefined,
      }
    );
  },
});

cli.addCommand({
  name: 'list',
  description: '列出已安装的全部能力',
  alias: 'ls',
  execute: async () => {
    const { projectPath, skillEngine } = await getContext();
    await list(projectPath, skillEngine);
  },
});

cli.addCommand({
  name: 'status',
  description: '查看已安装能力的状态',
  execute: async () => {
    const { projectPath, skillEngine } = await getContext();
    await status(projectPath, skillEngine);
  },
});

cli.addCommand({
  name: 'update',
  description: '从上游更新指定能力',
  argument: { name: 'id', description: '能力 ID', type: String },
  execute: async ({ argument }: Toolbox) => {
    const { projectPath, skillEngine } = await getContext();
    await update(projectPath, requireArgument(argument, 0, 'id'), skillEngine);
  },
});

cli.addCommand({
  name: 'publish',
  description: '发布已修改或新建的能力',
  argument: { name: 'id', description: '能力 ID', type: String },
  execute: async ({ argument }: Toolbox) => {
    const { projectPath, skillEngine } = await getContext();
    await publish(projectPath, requireArgument(argument, 0, 'id'), skillEngine);
  },
});

cli.addCommand({
  name: 'create',
  description: '新建自定义技能',
  argument: { name: 'name', description: '技能名称', type: String },
  execute: async ({ argument }: Toolbox) => {
    const { projectPath, skillEngine } = await getContext();
    await create(
      projectPath,
      requireArgument(argument, 0, 'name'),
      skillEngine
    );
  },
});

cli.addCommand({
  name: 'sync',
  description: '同步全部能力与上游',
  execute: async () => {
    const { projectPath, skillEngine } = await getContext();
    await sync(projectPath, skillEngine);
  },
});

cli.addCommand({
  name: 'reset',
  description: '将能力重置到上游版本',
  argument: { name: 'id', description: '能力 ID', type: String },
  execute: async ({ argument }: Toolbox) => {
    const { projectPath, skillEngine } = await getContext();
    await reset(projectPath, requireArgument(argument, 0, 'id'), skillEngine);
  },
});

cli.addCommand({
  name: 'remove',
  description: '移除指定能力',
  alias: 'rm',
  argument: { name: 'id', description: '能力 ID', type: String },
  execute: async ({ argument }: Toolbox) => {
    const { projectPath, skillEngine } = await getContext();
    await remove(projectPath, requireArgument(argument, 0, 'id'), skillEngine);
  },
});

await cli.run();
