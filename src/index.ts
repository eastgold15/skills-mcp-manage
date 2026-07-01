import { defineCli } from 'boune';
import { RuntimeDependencies } from './types';
import { getConfig } from './config';
import { createGitEffects } from './git';
import { createFSEffects } from './fs';
import { createUIEffects } from './ui';
import { createCommands } from './commands';

async function buildRuntimeDependencies(): Promise<RuntimeDependencies> {
  const config = await getConfig();
  return {
    config,
    fs: createFSEffects(),
    git: createGitEffects(),
    ui: createUIEffects(),
  };
}

async function main() {
  const deps = await buildRuntimeDependencies();
  const commands = createCommands(deps);

  const cli = defineCli({
    name: 'agent',
    version: '1.0.0',
    description: 'Agent Skills & MCP 统一管理 CLI 工具',
    commands,
  });

  await cli.run();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});