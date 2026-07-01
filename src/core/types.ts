export type CapabilityKind = 'skill' | 'mcp';

export type SourceType = 'git-subdir' | 'git' | 'registry' | 'created';

export type Source =
  | { type: 'git-subdir'; repoUrl: string; subPath: string }
  | { type: 'git'; repoUrl: string }
  | { type: 'registry'; registryUrl: string; entryKey: string }
  | { type: 'created' };

export type Version =
  | { hash: string; lastUpstreamHash?: string }
  | { semver: string };

export type CapabilityStatus = 'upstream' | 'modified' | 'forked' | 'created' | 'published';

export interface CapabilityConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface Capability {
  kind: CapabilityKind;
  displayName?: string;
  source: Source;
  status: CapabilityStatus;
  version?: Version;
  installPath: string;
  config?: CapabilityConfig;
  updatedAt: string;
}

export interface DependencyTable {
  version: number;
  capabilities: Record<string, Capability>;
}

export interface AgentConfig {
  cacheRoot: string;
  githubOrg: string;
  githubToken?: string;
}

export interface InstallOptions {
  from?: string;
  path?: string;
  name?: string;
}

export interface UpdateResult {
  success: boolean;
  conflicts: string[];
  updated: string[];
}

export interface StatusInfo {
  id: string;
  kind: CapabilityKind;
  status: CapabilityStatus;
  hash: string;
  lastUpstreamHash?: string;
  installPath: string;
  displayName?: string;
  isModified: boolean;
}