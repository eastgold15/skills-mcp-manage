import fs from 'fs-extra';
import { DependencyTable } from './types';

export async function scanProject(projectPath: string): Promise<DependencyTable> {
  const manifestPath = `${projectPath}/.agent/deps.json`;
  if (!(await fs.pathExists(manifestPath))) {
    return { version: 2, capabilities: {} };
  }
  const raw = await fs.readFile(manifestPath, 'utf-8');
  return JSON.parse(raw) as DependencyTable;
}

export async function scanCache(cacheRoot: string): Promise<string[]> {
  const skillsDir = `${cacheRoot}/skills`;
  if (!(await fs.pathExists(skillsDir))) {
    return [];
  }
  const entries = await fs.readdir(skillsDir);
  const repos: string[] = [];
  for (const entry of entries) {
    const entryPath = `${skillsDir}/${entry}`;
    const stat = await fs.stat(entryPath);
    if (stat.isDirectory()) {
      const gitDir = `${entryPath}/.git`;
      if (await fs.pathExists(gitDir)) {
        repos.push(entry);
      }
    }
  }
  return repos;
}