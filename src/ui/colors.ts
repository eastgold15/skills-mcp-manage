import chalk from 'chalk';

export const colors = {
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.blue,
  bold: chalk.bold,
  gray: chalk.gray,
  
  upstream: chalk.green,
  modified: chalk.yellow,
  forked: chalk.blue,
  created: chalk.cyan,
  published: chalk.magenta,
  
  skill: chalk.blue,
  mcp: chalk.magenta,
};

export function statusColor(status: string): typeof chalk {
  switch (status) {
    case 'upstream':
      return colors.upstream;
    case 'modified':
      return colors.modified;
    case 'forked':
      return colors.forked;
    case 'created':
      return colors.created;
    case 'published':
      return colors.published;
    default:
      return chalk;
  }
}

export function kindColor(kind: string): typeof chalk {
  switch (kind) {
    case 'skill':
      return colors.skill;
    case 'mcp':
      return colors.mcp;
    default:
      return chalk;
  }
}