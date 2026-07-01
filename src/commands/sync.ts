import { SkillEngine } from '../engines/skill-engine';
import { withSpinner } from '../ui/spinner';
import { printSuccess } from '../ui/prompts';

export async function sync(projectPath: string, engine: SkillEngine): Promise<void> {
  await withSpinner('Syncing all capabilities', async () => {
    await engine.sync(projectPath);
  });
  printSuccess('Synced all capabilities successfully');
}