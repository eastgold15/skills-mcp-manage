import type { SkillEngine } from '../engines/skill-engine';
import { colors } from '../ui/colors';
import { printSuccess, printWarning } from '../ui/prompts';
import { withSpinner } from '../ui/spinner';

export async function update(
  projectPath: string,
  id: string,
  engine: SkillEngine
): Promise<void> {
  const result = await withSpinner(`正在更新 ${id}`, async () => {
    return await engine.update(projectPath, id);
  });

  if (result.conflicts.length > 0) {
    printWarning(`检测到冲突：${result.conflicts.join('、')}`);
    printWarning('请先手动解决冲突再更新');
  } else if (result.updated.length > 0) {
    printSuccess(`已更新：${result.updated.join('、')}`);
  } else {
    console.log(colors.info(`${id} 无需更新`));
  }
}
