import simpleGit, { SimpleGit } from 'simple-git';
import fs from 'fs-extra';
import { getCachePath } from '../utils/path';

export interface RepoManager {
  clone: (url: string, dest: string) => Promise<void>;
  pull: (path: string) => Promise<void>;
  push: (path: string, remote: string) => Promise<void>;
  getHeadCommit: (path: string) => Promise<string>;
  checkoutCommit: (path: string, commit: string) => Promise<void>;
  hasUncommittedChanges: (path: string) => Promise<boolean>;
  getRemotes: (path: string) => Promise<Record<string, string>>;
  addRemote: (path: string, name: string, url: string) => Promise<void>;
  ensureCloned: (url: string, cacheRoot: string) => Promise<string>;
}

export function createRepoManager(): RepoManager {
  const getGit = (path: string): SimpleGit => {
    return simpleGit(path);
  };

  return {
    clone: async (url: string, dest: string) => {
      await simpleGit().clone(url, dest);
    },

    pull: async (path: string) => {
      const git = getGit(path);
      await git.pull();
    },

    push: async (path: string, remote: string) => {
      const git = getGit(path);
      await git.push(remote);
    },

    getHeadCommit: async (path: string) => {
      const git = getGit(path);
      const result = await git.revparse(['HEAD']);
      return result.trim();
    },

    checkoutCommit: async (path: string, commit: string) => {
      const git = getGit(path);
      await git.checkout(commit);
    },

    hasUncommittedChanges: async (path: string) => {
      const git = getGit(path);
      const status = await git.status();
      return !status.isClean();
    },

    getRemotes: async (path: string) => {
      const git = getGit(path);
      const remotes = await git.getRemotes(true);
      const result: Record<string, string> = {};
      for (const remote of remotes) {
        result[remote.name] = remote.refs.fetch;
      }
      return result;
    },

    addRemote: async (path: string, name: string, url: string) => {
      const git = getGit(path);
      await git.addRemote(name, url);
    },

    ensureCloned: async (url: string, cacheRoot: string): Promise<string> => {
      const cachePath = getCachePath(cacheRoot, url);
      
      if (await fs.pathExists(cachePath)) {
        const git = getGit(cachePath);
        await git.fetch();
        return cachePath;
      }
      
      await fs.ensureDir(`${cacheRoot}/skills`);
      await simpleGit().clone(url, cachePath);
      return cachePath;
    },
  };
}