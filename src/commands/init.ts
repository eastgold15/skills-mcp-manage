import { writeManifest } from '../core/manifest';
import { printSuccess } from '../ui/prompts';

export async function init(projectPath: string): Promise<void> {
  await writeManifest(projectPath, { version: 2, capabilities: {} });
  printSuccess(`已在 ${projectPath} 初始化 agent 项目`);
}
