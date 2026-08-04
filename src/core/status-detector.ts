import { isAccessible } from "@visulima/fs";
import { join } from "@visulima/path";
import { calculateDirectoryHash } from "../utils/hash";
import type { Capability, StatusInfo } from "./types";

export async function detectStatus(
  projectPath: string,
  capability: Capability
): Promise<StatusInfo> {
  const installFullPath = join(projectPath, capability.installPath);

  let currentHash = "";
  let isModified = false;

  if (await isAccessible(installFullPath)) {
    currentHash = await calculateDirectoryHash(installFullPath);
  }

  if (capability.version && "hash" in capability.version) {
    isModified = currentHash !== capability.version.hash;
  }

  return {
    displayName: capability.displayName,
    hash: currentHash,
    id: "",
    installPath: capability.installPath,
    isModified,
    kind: capability.kind,
    lastUpstreamHash:
      capability.version && "hash" in capability.version
        ? capability.version.hash
        : undefined,
    status: capability.status,
  };
}

export async function detectAllStatuses(
  projectPath: string,
  capabilities: Array<{ id: string; capability: Capability }>
): Promise<StatusInfo[]> {
  const statusPromises = capabilities.map(async ({ id, capability }) => {
    const status = await detectStatus(projectPath, capability);
    return { ...status, id };
  });
  // 统一等待全部完成
  const results = await Promise.all(statusPromises);
  return results;
}
