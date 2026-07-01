import { SkillEngine } from '../engines/skill-engine';
import { MCPEngine } from '../engines/mcp-engine';
import { withSpinner } from '../ui/spinner';
import { colors } from '../ui/colors';

export async function install(
  projectPath: string,
  source: string,
  engine: SkillEngine | MCPEngine
): Promise<void> {
  await withSpinner(`Installing ${source}`, async () => {
    await (engine as SkillEngine).install(projectPath, source);
  });
  console.log(colors.success(`Installed ${source} successfully`));
}