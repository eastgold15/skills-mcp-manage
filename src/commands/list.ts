import type { SkillEngine } from "../engines/skill-engine";
import { colors, kindColor, statusColor } from "../ui/colors";
import { printTable } from "../ui/prompts";

export async function list(
  projectPath: string,
  engine: SkillEngine
): Promise<void> {
  const capabilities = await engine.list(projectPath);

  if (capabilities.length === 0) {
    console.log(colors.info("尚未安装任何能力"));
    return;
  }

  const rows = capabilities.map(({ id, capability }) => [
    id,
    kindColor(capability.kind)(capability.kind),
    statusColor(capability.status)(capability.status),
    capability.installPath,
  ]);

  printTable(["ID", "类型", "状态", "安装路径"], rows);
}
