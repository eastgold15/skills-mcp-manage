import type { SkillEngine } from "../engines/skill-engine";
import { printSuccess } from "../ui/prompts";
import { withSpinner } from "../ui/spinner";

export async function create(
  projectPath: string,
  name: string,
  engine: SkillEngine
): Promise<void> {
  await withSpinner(`正在创建技能 ${name}`, async () => {
    await engine.create(projectPath, name);
  });
  printSuccess(`已创建技能 ${name}`);
}
