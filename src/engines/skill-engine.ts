import { VisulimaError } from "@visulima/error";
import { copy, ensureDir, remove, writeFile } from "@visulima/fs";
import { join } from "@visulima/path";
import {
  addCapability,
  listCapabilities,
  removeCapability,
  updateCapability,
} from "../core/manifest";
import { detectAllStatuses } from "../core/status-detector";
import type {
  Capability,
  CapabilityKind,
  InstallOptions,
  Source,
  UpdateResult,
} from "../core/types";
import type { RepoManager } from "../git/repo-manager";
import { calculateDirectoryHash } from "../utils/hash";
import { getSubPath } from "../utils/path";

export interface SkillEngine {
  create: (projectPath: string, name: string) => Promise<void>;
  install: (
    projectPath: string,
    source: string,
    options?: InstallOptions
  ) => Promise<void>;
  list: (
    projectPath: string
  ) => Promise<Array<{ id: string; capability: Capability }>>;
  publish: (projectPath: string, id: string) => Promise<void>;
  remove: (projectPath: string, id: string) => Promise<void>;
  status: (
    projectPath: string
  ) => Promise<
    Array<{ id: string; capability: Capability; isModified: boolean }>
  >;
  sync: (projectPath: string) => Promise<void>;
  update: (projectPath: string, id: string) => Promise<UpdateResult>;
}

export function createSkillEngine(
  repoManager: RepoManager,
  cacheRoot: string
): SkillEngine {
  const parseSource = (
    source: string
  ): { kind: CapabilityKind; source: Source } => {
    if (source.startsWith("git-subdir:")) {
      const parts = source.replace("git-subdir:", "").split("::");
      const repoUrl = parts[0] || "";
      const subPath = parts[1] || "";
      return {
        kind: "skill",
        source: { repoUrl, subPath, type: "git-subdir" },
      };
    }

    if (source.startsWith("git:")) {
      const repoUrl = source.replace("git:", "");
      return { kind: "skill", source: { repoUrl, type: "git" } };
    }

    if (source.startsWith("registry:")) {
      const parts = source.replace("registry:", "").split("::");
      const registryUrl = parts[0] || "";
      const entryKey = parts[1] || "";
      return {
        kind: "skill",
        source: { entryKey, registryUrl, type: "registry" },
      };
    }

    throw new VisulimaError({
      message: `无法识别的来源格式：${source}`,
      name: "InvalidSourceFormat",
    });
  };

  return {
    create: async (projectPath: string, name: string) => {
      const installPath = `./agent/skills/${name}`;
      const fullPath = join(projectPath, installPath);

      await ensureDir(fullPath);
      await writeFile(
        join(fullPath, "skill.yaml"),
        `name: ${name}\ndescription: Custom skill`
      );

      const capability: Capability = {
        installPath,
        kind: "skill",
        source: { type: "created" },
        status: "created",
        updatedAt: new Date().toISOString(),
      };

      await addCapability(projectPath, name, capability);
    },
    install: async (
      projectPath: string,
      source: string,
      options?: InstallOptions
    ) => {
      const { kind, source: parsedSource } = parseSource(source);
      const id =
        options?.name ||
        (parsedSource.type === "git-subdir"
          ? parsedSource.subPath.split("/").pop() || "skill"
          : source.split("/").pop() || "skill");

      let cachePath: string;
      let contentPath: string;

      if (parsedSource.type === "git-subdir") {
        cachePath = await repoManager.ensureCloned(
          parsedSource.repoUrl,
          cacheRoot
        );
        contentPath = getSubPath(cachePath, parsedSource.subPath);
      } else if (parsedSource.type === "git") {
        cachePath = await repoManager.ensureCloned(
          parsedSource.repoUrl,
          cacheRoot
        );
        contentPath = cachePath;
      } else {
        throw new VisulimaError({
          message: "仅支持 git-subdir 与 git 两种来源",
          name: "InvalidSourceFormat",
        });
      }

      const headCommit = await repoManager.getHeadCommit(cachePath);
      const hash = await calculateDirectoryHash(contentPath);
      const installPath = options?.path || `./agent/skills/${id}`;

      await copy(contentPath, join(projectPath, installPath));

      const capability: Capability = {
        installPath,
        kind,
        source: parsedSource,
        status: "upstream",
        updatedAt: new Date().toISOString(),
        version: { hash, lastUpstreamHash: headCommit },
      };

      await addCapability(projectPath, id, capability);
    },

    list: async (projectPath: string) => listCapabilities(projectPath),

    publish: async (projectPath: string, id: string) => {
      const capabilities = await listCapabilities(projectPath);
      const entry = capabilities.find((c) => c.id === id);

      if (!entry) {
        throw new VisulimaError({
          message: `未找到能力：${id}`,
          name: "CapabilityNotFound",
        });
      }

      await updateCapability(projectPath, id, {
        status: "published",
        updatedAt: new Date().toISOString(),
      });
    },

    remove: async (projectPath: string, id: string) => {
      const capability = await listCapabilities(projectPath).then(
        (list) => list.find((c) => c.id === id)?.capability
      );

      if (!capability) {
        return;
      }

      const installFullPath = join(projectPath, capability.installPath);
      await remove(installFullPath);
      await removeCapability(projectPath, id);
    },

    status: async (projectPath: string) => {
      const capabilities = await listCapabilities(projectPath);
      const statuses = await detectAllStatuses(projectPath, capabilities);

      return capabilities.map(({ id, capability }) => {
        const status = statuses.find((s) => s.id === id);
        return {
          capability,
          id,
          isModified: status?.isModified ?? false,
        };
      });
    },

    sync: async (projectPath: string) => {
      const capabilities = await listCapabilities(projectPath);

      const clonePromises = capabilities
        .filter(({ capability }) => {
          const t = capability.source.type;
          return t === "git" || t === "git-subdir";
        })
        .map(({ capability }) => {
          const src = capability.source as Extract<
            typeof capability.source,
            { type: "git" | "git-subdir" }
          >;
          return repoManager.ensureCloned(src.repoUrl, cacheRoot);
        });

      await Promise.all(clonePromises);
    },

    update: async (projectPath: string, id: string): Promise<UpdateResult> => {
      const capabilities = await listCapabilities(projectPath);
      const entry = capabilities.find((c) => c.id === id);

      if (!entry) {
        return { conflicts: [], success: false, updated: [] };
      }

      const { capability } = entry;
      const installFullPath = join(projectPath, capability.installPath);

      if (
        capability.source.type !== "git-subdir" &&
        capability.source.type !== "git"
      ) {
        return { conflicts: [], success: false, updated: [] };
      }

      const cachePath = await repoManager.ensureCloned(
        capability.source.repoUrl,
        cacheRoot
      );
      const contentPath =
        capability.source.type === "git-subdir"
          ? getSubPath(cachePath, capability.source.subPath)
          : cachePath;

      const headCommit = await repoManager.getHeadCommit(cachePath);
      const newHash = await calculateDirectoryHash(contentPath);
      const currentHash = await calculateDirectoryHash(installFullPath);

      const { version } = capability;
      const hasConflicts =
        version !== undefined &&
        "hash" in version &&
        currentHash !== version.hash;

      if (hasConflicts) {
        return { conflicts: [id], success: false, updated: [] };
      }

      await copy(contentPath, installFullPath, { overwrite: true });

      await updateCapability(projectPath, id, {
        status: "upstream",
        updatedAt: new Date().toISOString(),
        version: { hash: newHash, lastUpstreamHash: headCommit },
      });

      return { conflicts: [], success: true, updated: [id] };
    },
  };
}
