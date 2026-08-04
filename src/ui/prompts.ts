import { confirm, multiselect, select, text } from "@clack/prompts";
import { createTable } from "@visulima/tabular";
import { colors } from "./colors";

export async function askSelect<T>(
  message: string,
  choices: Array<{ label: string; value: T }>
): Promise<T> {
  const result = await select({
    message,
    options: choices.map((c) => ({
      label: c.label,
      value: c.value,
    })) as unknown as Parameters<typeof select>[0]["options"],
  });
  return result as T;
}

export async function askMultiSelect<T>(
  message: string,
  choices: Array<{ label: string; value: T }>
): Promise<T[]> {
  const result = await multiselect({
    message,
    options: choices.map((c) => ({
      label: c.label,
      value: c.value,
    })) as unknown as Parameters<typeof multiselect>[0]["options"],
  });
  return result as T[];
}

export async function askText(
  message: string,
  placeholder?: string
): Promise<string> {
  const result = await text({
    message,
    placeholder,
  });
  return result as string;
}

export async function askConfirm(message: string): Promise<boolean> {
  const result = await confirm({
    message,
  });
  return result as boolean;
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
