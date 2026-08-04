import type { SkillEngine } from "../engines/skill-engine";
import { printSuccess } from "../ui/prompts";
import { withSpinner } from "../ui/spinner";

export async function remove(
  projectPath: string,
  id: string,
  engine: SkillEngine
): Promise<void> {
  await withSpinner(`正在移除 ${id}`, async () => {
    await engine.remove(projectPath, id);
  });
  printSuccess(`已移除 ${id}`);
}
