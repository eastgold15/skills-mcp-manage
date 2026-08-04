export type CapabilityKind = "skill" | "mcp";

export type SourceType = "git-subdir" | "git" | "registry" | "created";

export type Source =
  | { type: "git-subdir"; repoUrl: string; subPath: string }
  | { type: "git"; repoUrl: string }
  | { type: "registry"; registryUrl: string; entryKey: string }
  | { type: "created" };

export type Version =
  | { hash: string; lastUpstreamHash?: string }
  | { semver: string };

export type CapabilityStatus =
  | "upstream"
  | "modified"
  | "forked"
  | "created"
  | "published";

export interface CapabilityConfig {
  args?: string[];
  command?: string;
  env?: Record<string, string>;
}

export interface Capability {
  config?: CapabilityConfig;
  displayName?: string;
  installPath: string;
  kind: CapabilityKind;
  source: Source;
  status: CapabilityStatus;
  updatedAt: string;
  version?: Version;
}

export interface DependencyTable {
  capabilities: Record<string, Capability>;
  version: number;
}

export interface AgentConfig {
  cacheRoot: string;
  githubOrg: string;
  githubToken?: string;
}

export interface InstallOptions {
  from?: string;
  name?: string;
  path?: string;
}

export interface UpdateResult {
  conflicts: string[];
  success: boolean;
  updated: string[];
}

export interface StatusInfo {
  displayName?: string;
  hash: string;
  id: string;
  installPath: string;
  isModified: boolean;
  kind: CapabilityKind;
  lastUpstreamHash?: string;
  status: CapabilityStatus;
}
