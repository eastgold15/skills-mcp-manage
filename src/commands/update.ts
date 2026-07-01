import { SkillEngine } from '../engines/skill-engine';
import { withSpinner } from '../ui/spinner';
import { colors } from '../ui/colors';
import { printWarning, printSuccess } from '../ui/prompts';

export async function update(
  projectPath: string,
  id: string,
  engine: SkillEngine
): Promise<void> {
  const result = await withSpinner(`Updating ${id}`, async () => {
    return await engine.update(projectPath, id);
  });

  if (result.conflicts.length > 0) {
    printWarning(`Conflicts detected for: ${result.conflicts.join(', ')}`);
    printWarning('Please resolve conflicts manually before updating');
  } else if (result.updated.length > 0) {
    printSuccess(`Updated: ${result.updated.join(', ')}`);
  } else {
    console.log(colors.info(`No updates needed for ${id}`));
  }
}