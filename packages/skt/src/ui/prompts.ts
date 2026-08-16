import { confirm, isCancel, multiselect, select, text } from "@clack/prompts";
import { createTable } from "@visulima/tabular";
import { colors } from "./colors";

/** 用户按 Ctrl+C / Esc 取消时抛出，由命令层决定如何收场 */
export class PromptCancelled extends Error {
  constructor() {
    super("已取消");
    this.name = "PromptCancelled";
  }
}

function unwrap<T>(value: T | symbol): T {
  if (isCancel(value)) {
    throw new PromptCancelled();
  }
  return value as T;
}

export async function askSelect<T>(
  message: string,
  choices: Array<{ label: string; value: T; hint?: string }>
): Promise<T> {
  const result = await select({
    message,
    options: choices.map((c) => ({
      label: c.label,
      value: c.value,
      ...(c.hint ? { hint: c.hint } : {}),
    })) as unknown as Parameters<typeof select>[0]["options"],
  });
  return unwrap(result) as T;
}

export async function askMultiSelect<T>(
  message: string,
  choices: Array<{ label: string; value: T; hint?: string }>
): Promise<T[]> {
  const result = await multiselect({
    message,
    options: choices.map((c) => ({
      label: c.label,
      value: c.value,
      ...(c.hint ? { hint: c.hint } : {}),
    })) as unknown as Parameters<typeof multiselect>[0]["options"],
    required: false,
  });
  return unwrap(result) as T[];
}

export async function askText(
  message: string,
  placeholder?: string
): Promise<string> {
  const result = await text({
    message,
    placeholder,
  });
  return unwrap(result) as string;
}

export async function askConfirm(message: string): Promise<boolean> {
  const result = await confirm({
    message,
  });
  return unwrap(result) as boolean;
}

export function printTable(headers: string[], rows: string[][]): void {
  const table = createTable();
  table.setHeaders(headers.map((h) => colors.bold(h)));

  for (const row of rows) {
    table.addRow(row);
  }

  console.log("");
  console.log(table.toString());
  console.log("");
}

export function printInfo(message: string): void {
  console.log(colors.info(message));
}

export function printError(message: string): void {
  console.error(colors.error(message));
}

export function printSuccess(message: string): void {
  console.log(colors.success(message));
}

export function printWarning(message: string): void {
  console.log(colors.warning(message));
}
