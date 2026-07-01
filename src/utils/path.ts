import path from 'path';

export function resolveHomePath(input: string): string {
  if (input.startsWith('~')) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return input.replace('~', homeDir);
  }
  return input;
}

export function normalizePath(input: string): string {
  return path.normalize(input).replace(/\\/g, '/');
}

export function getCachePath(cacheRoot: string, repoUrl: string): string {
  const repoName = repoUrl.replace(/\.git$/, '').split('/').pop() || 'unknown';
  return `${cacheRoot}/skills/${repoName}`;
}

export function getSubPath(cachePath: string, subPath: string): string {
  return `${cachePath}/${subPath}`;
}