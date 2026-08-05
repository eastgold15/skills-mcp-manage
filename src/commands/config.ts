import { configFile, ensureConfig } from "../core/config";
import { colors } from "../ui/colors";

/**
 * 显示扫描策略。
 *
 * 只读不改 —— 配置就是给人手工编辑的，工具代改反而抢了决定权。
 * 首次运行会写入默认值，之后原样保留。
 */
export async function showConfig(): Promise<void> {
  const config = await ensureConfig();

  console.log(colors.info("扫描策略"));
  console.log(colors.gray(`  ${configFile()}`));
  console.log("");
  console.log(colors.info("roots（扫描起点）"));
  for (const root of config.roots) {
    console.log(`  ${root}`);
  }
  console.log("");
  console.log(colors.info("include（命中即视为你的 skill，可被归一化）"));
  for (const pattern of config.include) {
    console.log(`  ${pattern}`);
  }
  console.log("");
  console.log(colors.info("exclude（挡掉第三方内置资源，优先级更高）"));
  for (const pattern of config.exclude) {
    console.log(colors.gray(`  ${pattern}`));
  }
  console.log("");
  console.log(
    colors.gray("直接编辑此文件调整范围，改完跑 agent scan --reuse 重新判定")
  );
}
