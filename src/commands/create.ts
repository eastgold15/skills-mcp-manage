import { SkillEngine } from '../engines/skill-engine';
import { withSpinner } from '../ui/spinner';
import { printSuccess, printError } from '../ui/prompts';

export async function create(
  projectPath: string,
  name: string,
  engine: SkillEngine
): Promise<void> {
  try {
    await withSpinner(`Creating skill ${name}`, async () => {
      await engine.create(projectPath, name);
    });
    printSuccess(`Created skill ${name} successfully`);
  } catch (error) {
    printError(`Failed to create skill ${name}: ${(error as Error).message}`);
  }
}