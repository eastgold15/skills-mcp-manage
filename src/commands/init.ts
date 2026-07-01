import { writeManifest } from '../core/manifest';
import { colors } from '../ui/colors';

export async function init(projectPath: string): Promise<void> {
  await writeManifest(projectPath, { version: 2, capabilities: {} });
  console.log(colors.success(`Initialized agent project at ${projectPath}`));
}