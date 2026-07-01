#!/usr/bin/env bun

import { defineCli, defineCommand } from 'boune';
import { init } from './commands/init';
import { install } from './commands/install';
import { list } from './commands/list';
import { status } from './commands/status';
import { update } from './commands/update';
import { publish } from './commands/publish';
import { create } from './commands/create';
import { sync } from './commands/sync';
import { reset } from './commands/reset';
import { remove } from './commands/remove';
import { createSkillEngine } from './engines/skill-engine';
import { createMCPEngine } from './engines/mcp-engine';
import { createRepoManager } from './git/repo-manager';
import { getConfig, ensureCacheDir } from './core/config';
import { printError } from './ui/prompts';

async function main() {
  const config = await getConfig();
  const cacheRoot = await ensureCacheDir(config.cacheRoot);
  const repoManager = createRepoManager();
  const skillEngine = createSkillEngine(repoManager, cacheRoot);
  const mcpEngine = createMCPEngine(repoManager, cacheRoot);

  const projectPath = process.cwd();

  const initCommand = defineCommand({
    name: 'init',
    description: 'Initialize a new agent project',
    action: async () => {
      try {
        await init(projectPath);
      } catch (error) {
        printError((error as Error).message);
      }
    },
  });

  const installCommand = defineCommand({
    name: 'install',
    description: 'Install a skill or MCP',
    arguments: {
      source: { type: 'string', required: true, description: 'Source of the capability' },
    },
    options: {
      name: { type: 'string', description: 'Custom name for the capability' },
      path: { type: 'string', description: 'Installation path' },
    },
    action: async ({ args, options }) => {
      try {
        if (args.source.startsWith('registry:')) {
          await install(projectPath, args.source, mcpEngine);
        } else {
          await install(projectPath, args.source, skillEngine);
        }
      } catch (error) {
        printError((error as Error).message);
      }
    },
  });

  const listCommand = defineCommand({
    name: 'list',
    description: 'List all installed capabilities',
    action: async () => {
      try {
        await list(projectPath, skillEngine);
      } catch (error) {
        printError((error as Error).message);
      }
    },
  });

  const statusCommand = defineCommand({
    name: 'status',
    description: 'Check status of installed capabilities',
    action: async () => {
      try {
        await status(projectPath, skillEngine);
      } catch (error) {
        printError((error as Error).message);
      }
    },
  });

  const updateCommand = defineCommand({
    name: 'update',
    description: 'Update a capability from upstream',
    arguments: {
      id: { type: 'string', required: true, description: 'ID of the capability to update' },
    },
    action: async ({ args }) => {
      try {
        await update(projectPath, args.id, skillEngine);
      } catch (error) {
        printError((error as Error).message);
      }
    },
  });

  const publishCommand = defineCommand({
    name: 'publish',
    description: 'Publish a modified/created capability',
    arguments: {
      id: { type: 'string', required: true, description: 'ID of the capability to publish' },
    },
    action: async ({ args }) => {
      try {
        await publish(projectPath, args.id, skillEngine);
      } catch (error) {
        printError((error as Error).message);
      }
    },
  });

  const createCommand = defineCommand({
    name: 'create',
    description: 'Create a new custom skill',
    arguments: {
      name: { type: 'string', required: true, description: 'Name of the new skill' },
    },
    action: async ({ args }) => {
      try {
        await create(projectPath, args.name, skillEngine);
      } catch (error) {
        printError((error as Error).message);
      }
    },
  });

  const syncCommand = defineCommand({
    name: 'sync',
    description: 'Sync all capabilities with upstream',
    action: async () => {
      try {
        await sync(projectPath, skillEngine);
      } catch (error) {
        printError((error as Error).message);
      }
    },
  });

  const resetCommand = defineCommand({
    name: 'reset',
    description: 'Reset a capability to upstream version',
    arguments: {
      id: { type: 'string', required: true, description: 'ID of the capability to reset' },
    },
    action: async ({ args }) => {
      try {
        await reset(projectPath, args.id, skillEngine);
      } catch (error) {
        printError((error as Error).message);
      }
    },
  });

  const removeCommand = defineCommand({
    name: 'remove',
    description: 'Remove a capability',
    arguments: {
      id: { type: 'string', required: true, description: 'ID of the capability to remove' },
    },
    action: async ({ args }) => {
      try {
        await remove(projectPath, args.id, skillEngine);
      } catch (error) {
        printError((error as Error).message);
      }
    },
  });

  const cli = defineCli({
    name: 'agent',
    version: '2.0.0',
    description: 'AI Agent Skills & MCP Unified Management CLI',
    commands: {
      init: initCommand,
      install: installCommand,
      list: listCommand,
      status: statusCommand,
      update: updateCommand,
      publish: publishCommand,
      create: createCommand,
      sync: syncCommand,
      reset: resetCommand,
      remove: removeCommand,
    },
  });

  await cli.run();
}

main().catch((error) => {
  printError((error as Error).message);
  process.exit(1);
});