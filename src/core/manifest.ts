import { ensureDir, isAccessible, readJson, writeJson } from '@visulima/fs';
import { dirname, join } from '@visulima/path';
import type { Capability, DependencyTable } from './types';

const MANIFEST_FILE = '.agent/deps.json';

/** 每次返回新对象，避免调用方修改后污染后续读取 */
function createDefaultManifest(): DependencyTable {
  return { version: 2, capabilities: {} };
}

export async function readManifest(
  projectPath: string
): Promise<DependencyTable> {
  const manifestPath = getManifestPath(projectPath);
  if (!(await isAccessible(manifestPath))) {
    return createDefaultManifest();
  }
  return await readJson<DependencyTable>(manifestPath);
}

export async function writeManifest(
  projectPath: string,
  manifest: DependencyTable
): Promise<void> {
  const manifestPath = getManifestPath(projectPath);
  await ensureDir(dirname(manifestPath));
  await writeJson(manifestPath, manifest, { indent: 2 });
}

export function getManifestPath(projectPath: string): string {
  return join(projectPath, MANIFEST_FILE);
}

export async function addCapability(
  projectPath: string,
  id: string,
  capability: Capability
): Promise<void> {
  const manifest = await readManifest(projectPath);
  manifest.capabilities[id] = capability;
  await writeManifest(projectPath, manifest);
}

export async function removeCapability(
  projectPath: string,
  id: string
): Promise<void> {
  const manifest = await readManifest(projectPath);
  delete manifest.capabilities[id];
  await writeManifest(projectPath, manifest);
}

export async function updateCapability(
  projectPath: string,
  id: string,
  updates: Partial<Capability>
): Promise<void> {
  const manifest = await readManifest(projectPath);
  const existing = manifest.capabilities[id];
  if (existing) {
    manifest.capabilities[id] = { ...existing, ...updates };
    await writeManifest(projectPath, manifest);
  }
}

export async function getCapability(
  projectPath: string,
  id: string
): Promise<Capability | undefined> {
  const manifest = await readManifest(projectPath);
  return manifest.capabilities[id];
}

export async function listCapabilities(
  projectPath: string
): Promise<Array<{ id: string; capability: Capability }>> {
  const manifest = await readManifest(projectPath);
  return Object.entries(manifest.capabilities).map(([id, capability]) => ({
    id,
    capability,
  }));
}
