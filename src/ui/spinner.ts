import ora from 'ora';

export function createSpinner(message: string) {
  return ora(message);
}

export async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const spinner = ora(message).start();
  try {
    const result = await task();
    spinner.succeed();
    return result;
  } catch {
    spinner.fail();
    throw new Error('Task failed');
  }
}