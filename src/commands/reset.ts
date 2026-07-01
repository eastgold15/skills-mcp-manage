import { SkillEngine } from '../engines/skill-engine';
import { withSpinner } from '../ui/spinner';
import { printSuccess, printError } from '../ui/prompts';

export async function reset(
  projectPath: string,
  id: string,
  engine: SkillEngine
): Promise<void> {
  try {
    await withSpinner(`Resetting ${id} to upstream`, async () => {
      await engine.update(projectPath, id);
    });
    printSuccess(`Reset ${id} to upstream successfully`);
  } catch (error) {
    printError(`Failed to reset ${id}: ${(error as Error).message}`);
  }
}