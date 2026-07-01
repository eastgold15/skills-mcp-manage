import fs from 'fs-extra';
import { Capability, CapabilityKind, Source, CapabilityStatus, InstallOptions, UpdateResult } from '../core/types';
import { addCapability, updateCapability, removeCapability, listCapabilities } from '../core/manifest';
import { detectAllStatuses } from '../core/status-detector';
import { calculateDirectoryHash } from '../utils/hash';
import { getCachePath, getSubPath } from '../utils/path';
import { RepoManager } from '../git/repo-manager';

export interface SkillEngine {
  install: (projectPath: string, source: string, options?: InstallOptions) => Promise<void>;
  update: (projectPath: string, id: string) => Promise<UpdateResult>;
  remove: (projectPath: string, id: string) => Promise<void>;
  list: (projectPath: string) => Promise<Array<{ id: string; capability: Capability }>>;
  status: (projectPath: string) => Promise<Array<{ id: string; capability: Capability; isModified: boolean }>>;
  create: (projectPath: string, name: string) => Promise<void>;
  publish: (projectPath: string, id: string) => Promise<void>;
  sync: (projectPath: string) => Promise<void>;
}

export function createSkillEngine(repoManager: RepoManager, cacheRoot: string): SkillEngine {
  const parseSource = (source: string): { kind: CapabilityKind; source: Source } => {
    if (source.startsWith('git-subdir:')) {
      const parts = source.replace('git-subdir:', '').split('::');
      const repoUrl = parts[0] || '';
      const subPath = parts[1] || '';
      return { kind: 'skill', source: { type: 'git-subdir', repoUrl, subPath } };
    }
    
    if (source.startsWith('git:')) {
      const repoUrl = source.replace('git:', '');
      return { kind: 'skill', source: { type: 'git', repoUrl } };
    }
    
    if (source.startsWith('registry:')) {
      const parts = source.replace('registry:', '').split('::');
      const registryUrl = parts[0] || '';
      const entryKey = parts[1] || '';
      return { kind: 'skill', source: { type: 'registry', registryUrl, entryKey } };
    }
    
    throw new Error(`Invalid source format: ${source}`);
  };

  return {
    install: async (projectPath: string, source: string, options?: InstallOptions) => {
      const { kind, source: parsedSource } = parseSource(source);
      const id = options?.name || 
        (parsedSource.type === 'git-subdir' ? parsedSource.subPath.split('/').pop() || 'skill' : 
         source.split('/').pop() || 'skill');

      let cachePath: string;
      let contentPath: string;
      
      if (parsedSource.type === 'git-subdir') {
        cachePath = await repoManager.ensureCloned(parsedSource.repoUrl, cacheRoot);
        contentPath = getSubPath(cachePath, parsedSource.subPath);
      } else if (parsedSource.type === 'git') {
        cachePath = await repoManager.ensureCloned(parsedSource.repoUrl, cacheRoot);
        contentPath = cachePath;
      } else {
        throw new Error('Only git-subdir and git sources are supported');
      }

      const headCommit = await repoManager.getHeadCommit(cachePath);
      const hash = await calculateDirectoryHash(contentPath);
      const installPath = options?.path || `./agent/skills/${id}`;

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

    update: async (projectPath: string, id: string): Promise<UpdateResult> => {
      const capabilities = await listCapabilities(projectPath);
      const entry = capabilities.find((c) => c.id === id);
      
      if (!entry) {
        return { success: false, conflicts: [], updated: [] };
      }

      const { capability } = entry;
      const installFullPath = `${projectPath}/${capability.installPath}`;
      
      if (capability.source.type !== 'git-subdir' && capability.source.type !== 'git') {
        return { success: false, conflicts: [], updated: [] };
      }

      const cachePath = await repoManager.ensureCloned(capability.source.repoUrl, cacheRoot);
      const contentPath = capability.source.type === 'git-subdir' 
        ? getSubPath(cachePath, capability.source.subPath)
        : cachePath;

      const headCommit = await repoManager.getHeadCommit(cachePath);
      const newHash = await calculateDirectoryHash(contentPath);
      const currentHash = await calculateDirectoryHash(installFullPath);

      const version = capability.version;
      const hasConflicts = version !== undefined && 'hash' in version && currentHash !== version.hash;
      
      if (hasConflicts) {
        return { success: false, conflicts: [id], updated: [] };
      }

      await fs.copy(contentPath, installFullPath, { overwrite: true });

      await updateCapability(projectPath, id, {
        version: { hash: newHash, lastUpstreamHash: headCommit },
        status: 'upstream',
        updatedAt: new Date().toISOString(),
      });

      return { success: true, conflicts: [], updated: [id] };
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

    create: async (projectPath: string, name: string) => {
      const installPath = `./agent/skills/${name}`;
      const fullPath = `${projectPath}/${installPath}`;
      
      await fs.ensureDir(fullPath);
      await fs.writeFile(`${fullPath}/skill.yaml`, `name: ${name}\ndescription: Custom skill`, 'utf-8');
      
      const capability: Capability = {
        kind: 'skill',
        source: { type: 'created' },
        status: 'created',
        installPath,
        updatedAt: new Date().toISOString(),
      };

      await addCapability(projectPath, name, capability);
    },

    publish: async (projectPath: string, id: string) => {
      const capabilities = await listCapabilities(projectPath);
      const entry = capabilities.find((c) => c.id === id);
      
      if (!entry) throw new Error(`Capability ${id} not found`);

      await updateCapability(projectPath, id, {
        status: 'published',
        updatedAt: new Date().toISOString(),
      });
    },

    sync: async (projectPath: string) => {
      const capabilities = await listCapabilities(projectPath);
      
      for (const { capability } of capabilities) {
        if (capability.source.type === 'git-subdir' || capability.source.type === 'git') {
          await repoManager.ensureCloned(capability.source.repoUrl, cacheRoot);
        }
      }
    },
  };
}