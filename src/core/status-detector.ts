import fs from 'fs-extra';
import { Capability, StatusInfo } from './types';
import { calculateDirectoryHash } from '../utils/hash';

export async function detectStatus(
  projectPath: string,
  capability: Capability
): Promise<StatusInfo> {
  const installFullPath = `${projectPath}/${capability.installPath}`;
  
  let currentHash = '';
  let isModified = false;
  
  if (await fs.pathExists(installFullPath)) {
    currentHash = await calculateDirectoryHash(installFullPath);
  }
  
  if (capability.version && 'hash' in capability.version) {
    isModified = currentHash !== capability.version.hash;
  }
  
  return {
    id: '',
    kind: capability.kind,
    status: capability.status,
    hash: currentHash,
    lastUpstreamHash: capability.version && 'hash' in capability.version ? capability.version.hash : undefined,
    installPath: capability.installPath,
    displayName: capability.displayName,
    isModified,
  };
}

export async function detectAllStatuses(
  projectPath: string,
  capabilities: Array<{ id: string; capability: Capability }>
): Promise<StatusInfo[]> {
  const results: StatusInfo[] = [];
  
  for (const { id, capability } of capabilities) {
    const status = await detectStatus(projectPath, capability);
    results.push({ ...status, id });
  }
  
  return results;
}