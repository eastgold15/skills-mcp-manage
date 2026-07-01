import { SkillEngine } from '../engines/skill-engine';
import { withSpinner } from '../ui/spinner';
import { printSuccess, printError } from '../ui/prompts';

export async function remove(
  projectPath: string,
  id: string,
  engine: SkillEngine
): Promise<void> {
  try {
    await withSpinner(`Removing ${id}`, async () => {
      await engine.remove(projectPath, id);
    });
    printSuccess(`Removed ${id} successfully`);
  } catch (error) {
    printError(`Failed to remove ${id}: ${(error as Error).message}`);
  }
}