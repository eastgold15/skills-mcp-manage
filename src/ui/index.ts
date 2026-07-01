import chalk from 'chalk';
import ora from 'ora';
import { select, multiselect, text, confirm } from '@clack/prompts';
import { UIEffects } from '../types';

export function createUIEffects(): UIEffects {
  return {
    showSelect: async <T>(options: { message: string; choices: { label: string; value: T }[] }) => {
      const result = await select({
        message: options.message,
        options: options.choices.map((c) => ({
          value: c.value,
          label: c.label,
        })) as unknown as Parameters<typeof select>[0]['options'],
      });
      return result as T;
    },

    showMultiSelect: async <T>(options: { message: string; choices: { label: string; value: T }[] }) => {
      const result = await multiselect({
        message: options.message,
        options: options.choices.map((c) => ({
          value: c.value,
          label: c.label,
        })) as unknown as Parameters<typeof multiselect>[0]['options'],
      });
      return result as T[];
    },

    showTextInput: async (options: { message: string; mask?: boolean }) => {
      const result = await text({
        message: options.message,
      });
      return result as string;
    },

    showConfirm: async (message: string) => {
      const result = await confirm({
        message,
      });
      return result as boolean;
    },

    showSpinner: async <A>(message: string, task: () => Promise<A>) => {
      const spinner = ora(message).start();
      try {
        const result = await task();
        spinner.succeed();
        return result;
      } catch {
        spinner.fail();
        throw new Error('Task failed');
      }
    },

    showConflictTree: async (conflicts: string[]) => {
      console.log('\n' + chalk.red('检测到合并冲突:'));
      for (const file of conflicts) {
        console.log('  - ' + chalk.yellow(file));
      }
      console.log('');

      const result = await select({
        message: '选择处理方式:',
        options: [
          { label: '打开编辑器手动解决', value: 'open-editor' },
          { label: '全部使用本地版本 (ours)', value: 'ours' },
          { label: '全部使用上游版本 (theirs)', value: 'theirs' },
          { label: '中止合并', value: 'abort' },
        ],
      });

      return result as 'open-editor' | 'abort' | 'ours' | 'theirs';
    },

    showSummary: async (results: Array<{ id: string; status: 'success' | 'conflict' | 'error' }>) => {
      console.log('\n' + chalk.bold('操作结果:'));
      for (const result of results) {
        let statusIcon = '';
        let statusColor = chalk;
        switch (result.status) {
          case 'success':
            statusIcon = '✓';
            statusColor = chalk.green;
            break;
          case 'conflict':
            statusIcon = '⚠';
            statusColor = chalk.yellow;
            break;
          case 'error':
            statusIcon = '✗';
            statusColor = chalk.red;
            break;
        }
        console.log(`  ${statusIcon} ${result.id}: ${statusColor(result.status)}`);
      }
      console.log('');
    },

    showTable: async <T>(options: { headers: string[]; data: T[]; format: (item: T) => string[] }) => {
      console.log('');
      const formattedHeaders = options.headers.map((h) => chalk.bold(h));
      console.log(' ' + formattedHeaders.join(' | '));
      console.log(' ' + options.headers.map(() => '---').join(' | '));

      for (const item of options.data) {
        const row = options.format(item);
        console.log(' ' + row.join(' | '));
      }
      console.log('');
    },

    showInfo: async (message: string) => {
      console.log(chalk.blue(message));
    },

    showError: async (message: string) => {
      console.error(chalk.red(message));
    },

    showSuccess: async (message: string) => {
      console.log(chalk.green(message));
    },
  };
}