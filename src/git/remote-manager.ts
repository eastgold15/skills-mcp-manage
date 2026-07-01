import { RepoManager } from './repo-manager';

export interface RemoteManager {
  addUpstream: (path: string, url: string) => Promise<void>;
  addOrigin: (path: string, url: string) => Promise<void>;
  getUpstreamUrl: (path: string) => Promise<string | undefined>;
  getOriginUrl: (path: string) => Promise<string | undefined>;
  removeRemote: (path: string, name: string) => Promise<void>;
}

export function createRemoteManager(repoManager: RepoManager): RemoteManager {
  return {
    addUpstream: async (path: string, url: string) => {
      await repoManager.addRemote(path, 'upstream', url);
    },

    addOrigin: async (path: string, url: string) => {
      await repoManager.addRemote(path, 'origin', url);
    },

    getUpstreamUrl: async (path: string) => {
      const remotes = await repoManager.getRemotes(path);
      return remotes.upstream;
    },

    getOriginUrl: async (path: string) => {
      const remotes = await repoManager.getRemotes(path);
      return remotes.origin;
    },

    removeRemote: async (path: string, name: string) => {
      const git = await import('simple-git').then((m) => m.default(path));
      await git.removeRemote(name);
    },
  };
}