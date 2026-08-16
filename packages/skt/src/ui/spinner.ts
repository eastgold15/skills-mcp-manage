import { spinner } from "@clack/prompts";

export function createSpinner(message: string) {
  const s = spinner();
  s.start(message);
  return s;
}

export async function withSpinner<T>(
  message: string,
  task: () => Promise<T>
): Promise<T> {
  const s = spinner();
  s.start(message);

  try {
    const result = await task();
    s.stop(message);
    return result;
  } catch (error) {
    s.error(message);
    // 原样上抛，保留真实错误原因
    throw error;
  }
}
