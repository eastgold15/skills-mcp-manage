import fs from 'fs-extra';
import { AgentConfig } from './types';
import { resolveHomePath } from '../utils/path';

const CONFIG_FILE = '~/.agent/config.json';

const DEFAULT_CONFIG: AgentConfig = {
  cacheRoot: '~/.agent/cache',
  githubOrg: 'trae-cn',
};

export async function getConfig(): Promise<AgentConfig> {
  const configPath = resolveHomePath(CONFIG_FILE);
  if (!(await fs.pathExists(configPath))) {
    return DEFAULT_CONFIG;
  }
  const raw = await fs.readFile(configPath, 'utf-8');
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export async function saveConfig(config: AgentConfig): Promise<void> {
  const configPath = resolveHomePath(CONFIG_FILE);
  await fs.ensureDir(resolveHomePath('~/.agent'));
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function initConfig(): Promise<void> {
  await saveConfig(DEFAULT_CONFIG);
}

export async function ensureCacheDir(cacheRoot: string): Promise<string> {
  const resolvedPath = resolveHomePath(cacheRoot);
  await fs.ensureDir(resolvedPath);
  return resolvedPath;
}