import type { SkillEngine } from "../engines/skill-engine";
import { printSuccess } from "../ui/prompts";
import { withSpinner } from "../ui/spinner";

export async function publish(
  projectPath: string,
  id: string,
  engine: SkillEngine
): Promise<void> {
  await withSpinner(`正在发布 ${id}`, async () => {
    await engine.publish(projectPath, id);
  });
  printSuccess(`已发布 ${id}`);
}
