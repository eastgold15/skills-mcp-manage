import type { RepoManager } from "./repo-manager";

export interface RemoteManager {
  addOrigin: (path: string, url: string) => Promise<void>;
  addUpstream: (path: string, url: string) => Promise<void>;
  getOriginUrl: (path: string) => Promise<string | undefined>;
  getUpstreamUrl: (path: string) => Promise<string | undefined>;
  removeRemote: (path: string, name: string) => Promise<void>;
}

export function createRemoteManager(repoManager: RepoManager): RemoteManager {
  return {
    addOrigin: async (path: string, url: string) => {
      await repoManager.addRemote(path, "origin", url);
    },
    addUpstream: async (path: string, url: string) => {
      await repoManager.addRemote(path, "upstream", url);
    },

    getOriginUrl: async (path: string) => {
      const remotes = await repoManager.getRemotes(path);
      return remotes.origin;
    },

    getUpstreamUrl: async (path: string) => {
      const remotes = await repoManager.getRemotes(path);
      return remotes.upstream;
    },

    removeRemote: async (path: string, name: string) => {
      const git = await import("simple-git").then((m) => m.default(path));
      await git.removeRemote(name);
    },
  };
}
