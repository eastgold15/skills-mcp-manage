import colorize from "@visulima/colorize";

type Colorizer = (text: string) => string;

export const colors = {
  bold: colorize.bold,
  created: colorize.cyan,
  error: colorize.red,
  forked: colorize.blue,
  gray: colorize.gray,
  info: colorize.blue,
  mcp: colorize.magenta,
  modified: colorize.yellow,
  published: colorize.magenta,

  skill: colorize.blue,
  success: colorize.green,

  upstream: colorize.green,
  warning: colorize.yellow,
};

export function statusColor(status: string): Colorizer {
  switch (status) {
    case "upstream":
      return colors.upstream;
    case "modified":
      return colors.modified;
    case "forked":
      return colors.forked;
    case "created":
      return colors.created;
    case "published":
      return colors.published;
    default:
      return (text: string) => text;
  }
}

export function kindColor(kind: string): Colorizer {
  switch (kind) {
    case "skill":
      return colors.skill;
    case "mcp":
      return colors.mcp;
    default:
      return (text: string) => text;
  }
}
