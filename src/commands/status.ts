import type { SkillEngine } from '../engines/skill-engine';
import { colors, kindColor, statusColor } from '../ui/colors';
import { printTable } from '../ui/prompts';

export async function status(
  projectPath: string,
  engine: SkillEngine
): Promise<void> {
  const capabilities = await engine.status(projectPath);

  if (capabilities.length === 0) {
    console.log(colors.info('尚未安装任何能力'));
    return;
  }

  const rows = capabilities.map(({ id, capability, isModified }) => {
    const version = capability.version;
    const hash =
      version && 'hash' in version ? version.hash.substring(0, 8) : '-';

    return [
      id,
      kindColor(capability.kind)(capability.kind),
      statusColor(capability.status)(capability.status),
      isModified ? colors.warning('已修改') : colors.success('干净'),
      hash,
    ];
  });

  printTable(['ID', '类型', '状态', '本地', '哈希'], rows);
}
