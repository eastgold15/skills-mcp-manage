import { VisulimaError } from "@visulima/error";
import { copy, ensureDir, remove, writeFile, writeJson } from "@visulima/fs";
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
} from "../core/types";
import type { RepoManager } from "../git/repo-manager";
import { calculateDirectoryHash } from "../utils/hash";

export interface MCPEngine {
  configure: (
    projectPath: string,
    id: string,
    config: Record<string, unknown>
  ) => Promise<void>;
  install: (
    projectPath: string,
    source: string,
    options?: InstallOptions
  ) => Promise<void>;
  list: (
    projectPath: string
  ) => Promise<Array<{ id: string; capability: Capability }>>;
  remove: (projectPath: string, id: string) => Promise<void>;
  status: (
    projectPath: string
  ) => Promise<
    Array<{ id: string; capability: Capability; isModified: boolean }>
  >;
  update: (projectPath: string, id: string) => Promise<void>;
}

export function createMCPEngine(
  repoManager: RepoManager,
  cacheRoot: string
): MCPEngine {
  const parseSource = (
    source: string
  ): { kind: CapabilityKind; source: Source } => {
    if (source.startsWith("registry:")) {
      const parts = source.replace("registry:", "").split("::");
      const registryUrl = parts[0] || "";
      const entryKey = parts[1] || "";
      return {
        kind: "mcp",
        source: { entryKey, registryUrl, type: "registry" },
      };
    }

    if (source.startsWith("git:")) {
      const repoUrl = source.replace("git:", "");
      return { kind: "mcp", source: { repoUrl, type: "git" } };
    }

    throw new VisulimaError({
      message: `无法识别的 MCP 来源格式：${source}`,
      name: "InvalidSourceFormat",
    });
  };

  return {
    configure: async (
      projectPath: string,
      id: string,
      config: Record<string, unknown>
    ) => {
      const capabilities = await listCapabilities(projectPath);
      const entry = capabilities.find((c) => c.id === id);

      if (!entry) {
        throw new VisulimaError({
          message: `未找到 MCP：${id}`,
          name: "MCP_NOT_FOUND",
        });
      }

      const { capability } = entry;
      const { installPath } = capability;
      const mcpConfigPath = join(projectPath, installPath, "config.yaml");

      await writeJson(mcpConfigPath, config, { indent: 2 });

      await updateCapability(projectPath, id, {
        config: {
          args: config.args as string[],
          command: config.command as string,
          env: config.env as Record<string, string>,
        },
        updatedAt: new Date().toISOString(),
      });
    },
    install: async (
      projectPath: string,
      source: string,
      options?: InstallOptions
    ) => {
      const { kind, source: parsedSource } = parseSource(source);
      const id = options?.name || source.split("/").pop() || "mcp";

      let contentPath: string;
      let headCommit = "";

      if (parsedSource.type === "git") {
        const cachePath = await repoManager.ensureCloned(
          parsedSource.repoUrl,
          cacheRoot
        );
        contentPath = cachePath;
        headCommit = await repoManager.getHeadCommit(cachePath);
      } else if (parsedSource.type === "registry") {
        contentPath = join(cacheRoot, "mcps", id);
        await ensureDir(contentPath);
        await writeFile(
          join(contentPath, "mcp.yaml"),
          `name: ${id}\ndescription: MCP from registry`
        );
      } else {
        throw new VisulimaError({
          message: "仅支持 git 与 registry 两种来源",
          name: "InvalidSourceFormat",
        });
      }

      const hash = await calculateDirectoryHash(contentPath);
      const installPath = options?.path || `./agent/mcps/${id}`;

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

    update: async (projectPath: string, id: string) => {
      const capabilities = await listCapabilities(projectPath);
      const entry = capabilities.find((c) => c.id === id);

      if (!entry) {
        return;
      }

      const { capability } = entry;
      const installFullPath = join(projectPath, capability.installPath);

      if (capability.source.type === "git") {
        const cachePath = await repoManager.ensureCloned(
          capability.source.repoUrl,
          cacheRoot
        );
        const headCommit = await repoManager.getHeadCommit(cachePath);
        const hash = await calculateDirectoryHash(cachePath);

        await copy(cachePath, installFullPath, { overwrite: true });

        await updateCapability(projectPath, id, {
          updatedAt: new Date().toISOString(),
          version: { hash, lastUpstreamHash: headCommit },
        });
      }
    },
  };
}
