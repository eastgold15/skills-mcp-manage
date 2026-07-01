import fs from 'fs-extra';
import { Capability, CapabilityKind, Source, CapabilityStatus, InstallOptions } from '../core/types';
import { addCapability, updateCapability, removeCapability, listCapabilities } from '../core/manifest';
import { detectAllStatuses } from '../core/status-detector';
import { calculateDirectoryHash } from '../utils/hash';
import { getCachePath } from '../utils/path';
import { RepoManager } from '../git/repo-manager';

export interface MCPEngine {
  install: (projectPath: string, source: string, options?: InstallOptions) => Promise<void>;
  update: (projectPath: string, id: string) => Promise<void>;
  remove: (projectPath: string, id: string) => Promise<void>;
  list: (projectPath: string) => Promise<Array<{ id: string; capability: Capability }>>;
  status: (projectPath: string) => Promise<Array<{ id: string; capability: Capability; isModified: boolean }>>;
  configure: (projectPath: string, id: string, config: Record<string, unknown>) => Promise<void>;
}

export function createMCPEngine(repoManager: RepoManager, cacheRoot: string): MCPEngine {
  const parseSource = (source: string): { kind: CapabilityKind; source: Source } => {
    if (source.startsWith('registry:')) {
      const parts = source.replace('registry:', '').split('::');
      const registryUrl = parts[0] || '';
      const entryKey = parts[1] || '';
      return { kind: 'mcp', source: { type: 'registry', registryUrl, entryKey } };
    }
    
    if (source.startsWith('git:')) {
      const repoUrl = source.replace('git:', '');
      return { kind: 'mcp', source: { type: 'git', repoUrl } };
    }
    
    throw new Error(`Invalid MCP source format: ${source}`);
  };

  return {
    install: async (projectPath: string, source: string, options?: InstallOptions) => {
      const { kind, source: parsedSource } = parseSource(source);
      const id = options?.name || source.split('/').pop() || 'mcp';

      let contentPath: string;
      let headCommit = '';

      if (parsedSource.type === 'git') {
        const cachePath = await repoManager.ensureCloned(parsedSource.repoUrl, cacheRoot);
        contentPath = cachePath;
        headCommit = await repoManager.getHeadCommit(cachePath);
      } else if (parsedSource.type === 'registry') {
        contentPath = `${cacheRoot}/mcps/${id}`;
        await fs.ensureDir(contentPath);
        await fs.writeFile(`${contentPath}/mcp.yaml`, `name: ${id}\ndescription: MCP from registry`, 'utf-8');
      } else {
        throw new Error('Only git and registry sources are supported');
      }

      const hash = await calculateDirectoryHash(contentPath);
      const installPath = options?.path || `./agent/mcps/${id}`;

      await fs.copy(contentPath, `${projectPath}/${installPath}`);

      const capability: Capability = {
        kind,
        source: parsedSource,
        status: 'upstream',
        version: { hash, lastUpstreamHash: headCommit },
        installPath,
        updatedAt: new Date().toISOString(),
      };

      await addCapability(projectPath, id, capability);
    },

    update: async (projectPath: string, id: string) => {
      const capabilities = await listCapabilities(projectPath);
      const entry = capabilities.find((c) => c.id === id);
      
      if (!entry) return;

      const { capability } = entry;
      const installFullPath = `${projectPath}/${capability.installPath}`;
      
      if (capability.source.type === 'git') {
        const cachePath = await repoManager.ensureCloned(capability.source.repoUrl, cacheRoot);
        const headCommit = await repoManager.getHeadCommit(cachePath);
        const hash = await calculateDirectoryHash(cachePath);
        
        await fs.copy(cachePath, installFullPath, { overwrite: true });
        
        await updateCapability(projectPath, id, {
          version: { hash, lastUpstreamHash: headCommit },
          updatedAt: new Date().toISOString(),
        });
      }
    },

    remove: async (projectPath: string, id: string) => {
      const capability = await listCapabilities(projectPath).then((list) => 
        list.find((c) => c.id === id)?.capability
      );
      
      if (!capability) return;

      const installFullPath = `${projectPath}/${capability.installPath}`;
      await fs.remove(installFullPath);
      await removeCapability(projectPath, id);
    },

    list: async (projectPath: string) => {
      return listCapabilities(projectPath);
    },

    status: async (projectPath: string) => {
      const capabilities = await listCapabilities(projectPath);
      const statuses = await detectAllStatuses(projectPath, capabilities);
      
      return capabilities.map(({ id, capability }) => {
        const status = statuses.find((s) => s.id === id);
        return {
          id,
          capability,
          isModified: status?.isModified || false,
        };
      });
    },

    configure: async (projectPath: string, id: string, config: Record<string, unknown>) => {
      const capabilities = await listCapabilities(projectPath);
      const entry = capabilities.find((c) => c.id === id);
      
      if (!entry) throw new Error(`MCP ${id} not found`);

      const capability = entry.capability;
      const mcpConfigPath = `${projectPath}/${capability.installPath}/config.yaml`;
      
      await fs.writeFile(mcpConfigPath, JSON.stringify(config, null, 2), 'utf-8');
      
      await updateCapability(projectPath, id, {
        config: {
          command: config.command as string,
          args: config.args as string[],
          env: config.env as Record<string, string>,
        },
        updatedAt: new Date().toISOString(),
      });
    },
  };
}