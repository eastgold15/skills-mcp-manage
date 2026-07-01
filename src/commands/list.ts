import { SkillEngine } from '../engines/skill-engine';
import { colors, statusColor, kindColor } from '../ui/colors';
import { printTable } from '../ui/prompts';

export async function list(projectPath: string, engine: SkillEngine): Promise<void> {
  const capabilities = await engine.list(projectPath);
  
  if (capabilities.length === 0) {
    console.log(colors.info('No capabilities installed'));
    return;
  }

  const rows = capabilities.map(({ id, capability }) => [
    id,
    kindColor(capability.kind)(capability.kind),
    statusColor(capability.status)(capability.status),
    capability.installPath,
  ]);

  printTable(['ID', 'Kind', 'Status', 'Path'], rows);
}