import { SkillEngine } from '../engines/skill-engine';
import { colors, statusColor, kindColor } from '../ui/colors';
import { printTable } from '../ui/prompts';

export async function status(projectPath: string, engine: SkillEngine): Promise<void> {
  const capabilities = await engine.status(projectPath);
  
  if (capabilities.length === 0) {
    console.log(colors.info('No capabilities installed'));
    return;
  }

  const rows = capabilities.map(({ id, capability, isModified }) => {
    const version = capability.version;
    const hash = version && 'hash' in version ? version.hash.substring(0, 8) : '-';
    
    return [
      id,
      kindColor(capability.kind)(capability.kind),
      statusColor(capability.status)(capability.status),
      isModified ? colors.warning('modified') : colors.success('clean'),
      hash,
    ];
  });

  printTable(['ID', 'Kind', 'Status', 'Local', 'Hash'], rows);
}