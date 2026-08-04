import type { SkillEngine } from '../engines/skill-engine';
import { printSuccess } from '../ui/prompts';
import { withSpinner } from '../ui/spinner';

export async function reset(
  projectPath: string,
  id: string,
  engine: SkillEngine
): Promise<void> {
  await withSpinner(`正在将 ${id} 重置到上游版本`, async () => {
    await engine.update(projectPath, id);
  });
  printSuccess(`已将 ${id} 重置到上游版本`);
}
