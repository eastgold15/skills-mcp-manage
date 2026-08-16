import { VisulimaError } from "@visulima/error";

/**
 * 取位置参数，缺失时抛错。
 *
 * cerebro 的 ArgumentDefinition 没有 required 字段，不传参时 toolbox.argument
 * 是空数组且静默通过，因此必填校验只能在命令内自己做。
 */
export function requireArgument(
  argument: string[],
  index: number,
  name: string
): string {
  const value = argument[index];

  if (!value) {
    throw new VisulimaError({
      hint: `用法：agent <命令> <${name}>`,
      message: `缺少必填参数 <${name}>`,
      name: "MissingArgument",
    });
  }

  return value;
}
