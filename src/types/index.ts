export type SkillId = string;
export type CachePath = string;
export type ProjectPath = string;

export type RemoteRelation = {
  upstream?: string;
  origin: string;
};

export type SkillMeta = {
  id: SkillId;
  path: CachePath;
  remotes: RemoteRelation;
  currentBranch: string;
  hasUncommittedChanges: boolean;
  lastCommit: { hash: string; date: Date; message: string };
  behindUpstream?: number;
};

export type ProjectSkillEntry = {
  skillId: SkillId;
  installType: 'copy' | 'symlink';
  sourcePath: CachePath;
  targetPath: string;
  pinnedCommit?: string;
};

export type McpServerEntry = {
  id: string;
  name: string;
  path: string;
};

export type ProjectManifest = {
  version: 1;
  skills: ProjectSkillEntry[];
  mcps?: McpServerEntry[];
};

export type Config = {
  cacheRoot: string;
  githubOrg: string;
  githubToken?: string;
};

export type GitEffects = {
  clone: (url: string, dest: CachePath) => Promise<void>;
  fetchUpstream: (path: CachePath) => Promise<void>;
  mergeUpstream: (path: CachePath, branch: string) => Promise<{ merged: boolean; conflictFiles: string[] }>;
  pushToOrigin: (path: CachePath) => Promise<void>;
  getHeadCommit: (path: CachePath) => Promise<string>;
  getBranch: (path: CachePath) => Promise<string>;
  getRemotes: (path: CachePath) => Promise<Record<string, string>>;
  addRemote: (path: CachePath, name: string, url: string) => Promise<void>;
  removeRemote: (path: CachePath, name: string) => Promise<void>;
  hasUncommittedChanges: (path: CachePath) => Promise<boolean>;
  getLastCommit: (path: CachePath) => Promise<{ hash: string; date: Date; message: string }>;
  checkout: (path: CachePath, commit: string) => Promise<void>;
  resetHard: (path: CachePath, commit: string) => Promise<void>;
  abortMerge: (path: CachePath) => Promise<void>;
  checkoutOurs: (path: CachePath, files: string[]) => Promise<void>;
  checkoutTheirs: (path: CachePath, files: string[]) => Promise<void>;
  addFiles: (path: CachePath, files: string[]) => Promise<void>;
  commit: (path: CachePath, message: string) => Promise<void>;
  createBranch: (path: CachePath, name: string) => Promise<void>;
};

export type FSEffects = {
  copyDir: (src: CachePath, dest: string) => Promise<void>;
  createSymlink: (target: CachePath, linkPath: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  readManifest: (projectPath: ProjectPath) => Promise<ProjectManifest | null>;
  writeManifest: (projectPath: ProjectPath, manifest: ProjectManifest) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  readDir: (path: string) => Promise<string[]>;
  mkdir: (path: string) => Promise<void>;
  isDirectory: (path: string) => Promise<boolean>;
  isSymlink: (path: string) => Promise<boolean>;
  resolveSymlink: (path: string) => Promise<string>;
};

export type UIEffects = {
  showSelect: <T>(options: { message: string; choices: { label: string; value: T }[] }) => Promise<T>;
  showMultiSelect: <T>(options: { message: string; choices: { label: string; value: T }[] }) => Promise<T[]>;
  showTextInput: (options: { message: string; mask?: boolean }) => Promise<string>;
  showConfirm: (message: string) => Promise<boolean>;
  showSpinner: <A>(message: string, task: () => Promise<A>) => Promise<A>;
  showConflictTree: (conflicts: string[]) => Promise<'open-editor' | 'abort' | 'resolve-all' | 'ours' | 'theirs'>;
  showSummary: (results: Array<{ id: string; status: 'success' | 'conflict' | 'error' }>) => Promise<void>;
  showTable: <T>(options: { headers: string[]; data: T[]; format: (item: T) => string[] }) => Promise<void>;
  showInfo: (message: string) => Promise<void>;
  showError: (message: string) => Promise<void>;
  showSuccess: (message: string) => Promise<void>;
};

export type RuntimeDependencies = {
  config: Config;
  fs: FSEffects;
  git: GitEffects;
  ui: UIEffects;
};