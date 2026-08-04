import { ensureDir, isAccessible, readJson, writeJson } from "@visulima/fs";
import { resolveHomePath } from "../utils/path";
import type { AgentConfig } from "./types";

const CONFIG_DIR = "~/.agent";
const CONFIG_FILE = "~/.agent/config.json";

const DEFAULT_CONFIG: AgentConfig = {
  cacheRoot: "~/.agent/cache",
  githubOrg: "trae-cn",
};

export async function getConfig(): Promise<AgentConfig> {
  const configPath = resolveHomePath(CONFIG_FILE);
  if (!(await isAccessible(configPath))) {
    return DEFAULT_CONFIG;
  }
  const raw = await readJson<Partial<AgentConfig>>(configPath);
  return { ...DEFAULT_CONFIG, ...raw };
}

export async function saveConfig(config: AgentConfig): Promise<void> {
  await ensureDir(resolveHomePath(CONFIG_DIR));
  await writeJson(resolveHomePath(CONFIG_FILE), config, { indent: 2 });
}

export async function initConfig(): Promise<void> {
  await saveConfig(DEFAULT_CONFIG);
}

export async function ensureCacheDir(cacheRoot: string): Promise<string> {
  const resolvedPath = resolveHomePath(cacheRoot);
  await ensureDir(resolvedPath);
  return resolvedPath;
}
