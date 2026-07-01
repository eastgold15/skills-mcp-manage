import { Config } from '../types';
import fs from 'fs-extra';

const CONFIG_FILE = '.agent-cli-config.json';
const DEFAULT_CACHE_ROOT = `${process.env.HOME || process.env.USERPROFILE}/.agent/skills`;

export async function getConfig(): Promise<Config> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const configPath = `${homeDir}/${CONFIG_FILE}`;

  if (await fs.pathExists(configPath)) {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  }

  return {
    cacheRoot: DEFAULT_CACHE_ROOT,
    githubOrg: '',
    githubToken: undefined,
  };
}

export async function saveConfig(config: Config): Promise<void> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const configPath = `${homeDir}/${CONFIG_FILE}`;
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function initConfig(): Promise<Config> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const configPath = `${homeDir}/${CONFIG_FILE}`;
  const cacheRoot = DEFAULT_CACHE_ROOT;

  await fs.ensureDir(cacheRoot);

  const config: Config = {
    cacheRoot,
    githubOrg: '',
    githubToken: undefined,
  };

  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

export async function ensureCacheDir(cacheRoot: string): Promise<void> {
  await fs.ensureDir(cacheRoot);
}