import { ensureDir, isAccessible } from "@visulima/fs";
import { join } from "@visulima/path";
import simpleGit, { type SimpleGit } from "simple-git";
import { getCachePath } from "../utils/path";

export interface RepoManager {
  addRemote: (path: string, name: string, url: string) => Promise<void>;
  checkoutCommit: (path: string, commit: string) => Promise<void>;
  clone: (url: string, dest: string) => Promise<void>;
  ensureCloned: (url: string, cacheRoot: string) => Promise<string>;
  getHeadCommit: (path: string) => Promise<string>;
  getRemotes: (path: string) => Promise<Record<string, string>>;
  hasUncommittedChanges: (path: string) => Promise<boolean>;
  pull: (path: string) => Promise<void>;
  push: (path: string, remote: string) => Promise<void>;
}

export function createRepoManager(): RepoManager {
  const getGit = (path: string): SimpleGit => simpleGit(path);

  return {
    addRemote: async (path: string, name: string, url: string) => {
      const git = getGit(path);
      await git.addRemote(name, url);
    },

    checkoutCommit: async (path: string, commit: string) => {
      const git = getGit(path);
      await git.checkout(commit);
    },
    clone: async (url: string, dest: string) => {
      await simpleGit().clone(url, dest);
    },

    ensureCloned: async (url: string, cacheRoot: string): Promise<string> => {
      const cachePath = getCachePath(cacheRoot, url);

      if (await isAccessible(cachePath)) {
        const git = getGit(cachePath);
        await git.fetch();
        return cachePath;
      }

      await ensureDir(join(cacheRoot, "skills"));
      await simpleGit().clone(url, cachePath);
      return cachePath;
    },

    getHeadCommit: async (path: string) => {
      const git = getGit(path);
      const result = await git.revparse(["HEAD"]);
      return result.trim();
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

    hasUncommittedChanges: async (path: string) => {
      const git = getGit(path);
      const status = await git.status();
      return !status.isClean();
    },

    pull: async (path: string) => {
      const git = getGit(path);
      await git.pull();
    },

    push: async (path: string, remote: string) => {
      const git = getGit(path);
      await git.push(remote);
    },
  };
}
