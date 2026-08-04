import type { SkillEngine } from "../engines/skill-engine";
import { printSuccess } from "../ui/prompts";
import { withSpinner } from "../ui/spinner";

export async function sync(
  projectPath: string,
  engine: SkillEngine
): Promise<void> {
  await withSpinner("正在同步全部能力", async () => {
    await engine.sync(projectPath);
  });
  printSuccess("已同步全部能力");
}
