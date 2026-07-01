import { SkillEngine } from '../engines/skill-engine';
import { withSpinner } from '../ui/spinner';
import { printSuccess, printError } from '../ui/prompts';

export async function publish(
  projectPath: string,
  id: string,
  engine: SkillEngine
): Promise<void> {
  try {
    await withSpinner(`Publishing ${id}`, async () => {
      await engine.publish(projectPath, id);
    });
    printSuccess(`Published ${id} successfully`);
  } catch (error) {
    printError(`Failed to publish ${id}: ${(error as Error).message}`);
  }
}