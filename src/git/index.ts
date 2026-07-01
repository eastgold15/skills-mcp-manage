import simpleGit, { SimpleGit } from 'simple-git';
import { GitEffects, CachePath } from '../types';

export function createGitEffects(): GitEffects {
  const getGit = (path: CachePath): SimpleGit => {
    return simpleGit(path);
  };

  return {
    clone: async (url: string, dest: CachePath) => {
      await simpleGit().clone(url, dest);
    },

    fetchUpstream: async (path: CachePath) => {
      const git = getGit(path);
      await git.fetch('upstream');
    },

    mergeUpstream: async (path: CachePath, branch: string) => {
      const git = getGit(path);
      try {
        await git.mergeFromTo(`upstream/${branch}`, branch);
        return { merged: true, conflictFiles: [] };
      } catch {
        const status = await git.status();
        return { merged: false, conflictFiles: status.conflicted || [] };
      }
    },

    pushToOrigin: async (path: CachePath) => {
      const git = getGit(path);
      await git.push('origin');
    },

    getHeadCommit: async (path: CachePath) => {
      const git = getGit(path);
      const result = await git.revparse(['HEAD']);
      return result.trim();
    },

    getBranch: async (path: CachePath) => {
      const git = getGit(path);
      const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim();
    },

    getRemotes: async (path: CachePath) => {
      const git = getGit(path);
      const remotes = await git.getRemotes(true);
      const result: Record<string, string> = {};
      for (const remote of remotes) {
        result[remote.name] = remote.refs.fetch;
      }
      return result;
    },

    addRemote: async (path: CachePath, name: string, url: string) => {
      const git = getGit(path);
      await git.addRemote(name, url);
    },

    removeRemote: async (path: CachePath, name: string) => {
      const git = getGit(path);
      await git.removeRemote(name);
    },

    hasUncommittedChanges: async (path: CachePath) => {
      const git = getGit(path);
      const status = await git.status();
      return !status.isClean();
    },

    getLastCommit: async (path: CachePath) => {
      const git = getGit(path);
      const log = await git.log({ maxCount: 1 });
      const commit = log.latest;
      if (!commit) {
        return { hash: '', date: new Date(), message: '' };
      }
      return {
        hash: commit.hash,
        date: new Date(commit.date),
        message: commit.message.trim(),
      };
    },

    checkout: async (path: CachePath, commit: string) => {
      const git = getGit(path);
      await git.checkout(commit);
    },

    resetHard: async (path: CachePath, commit: string) => {
      const git = getGit(path);
      await git.reset(['--hard', commit]);
    },

    abortMerge: async (path: CachePath) => {
      const git = getGit(path);
      await git.merge(['--abort']).catch(() => {});
    },

    checkoutOurs: async (path: CachePath, files: string[]) => {
      const git = getGit(path);
      await git.checkout(['--ours', '.']);
      await git.add(files);
    },

    checkoutTheirs: async (path: CachePath, files: string[]) => {
      const git = getGit(path);
      await git.checkout(['--theirs', '.']);
      await git.add(files);
    },

    addFiles: async (path: CachePath, files: string[]) => {
      const git = getGit(path);
      await git.add(files);
    },

    commit: async (path: CachePath, message: string) => {
      const git = getGit(path);
      await git.commit(message);
    },

    createBranch: async (path: CachePath, name: string) => {
      const git = getGit(path);
      await git.checkout(['-b', name]);
    },
  };
}