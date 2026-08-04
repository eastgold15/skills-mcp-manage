import { isAccessible, readJson, walk } from '@visulima/fs';
import { join } from '@visulima/path';
import type { DependencyTable } from './types';

export async function scanProject(
  projectPath: string
): Promise<DependencyTable> {
  const manifestPath = join(projectPath, '.agent', 'deps.json');
  if (!(await isAccessible(manifestPath))) {
    return { version: 2, capabilities: {} };
  }
  return await readJson<DependencyTable>(manifestPath);
}

export async function scanCache(cacheRoot: string): Promise<string[]> {
  const skillsDir = join(cacheRoot, 'skills');
  if (!(await isAccessible(skillsDir))) {
    return [];
  }

  const repos: string[] = [];

  // maxDepth 1 只看直接子项；walk 会 yield 起始目录自身，需跳过
  for await (const entry of walk(skillsDir, {
    maxDepth: 1,
    includeFiles: false,
  })) {
    if (entry.path === skillsDir) {
      continue;
    }
    if (
      entry.isDirectory() &&
      (await isAccessible(join(entry.path, '.git')))
    ) {
      repos.push(entry.name);
    }
  }

  return repos;
}
