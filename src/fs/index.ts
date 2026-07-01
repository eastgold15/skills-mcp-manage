import fs from 'fs-extra';
import path from 'path';
import { FSEffects, CachePath, ProjectPath, ProjectManifest } from '../types';

const MANIFEST_FILE = '.agent-deps.json';

export function createFSEffects(): FSEffects {
  return {
    copyDir: async (src: CachePath, dest: string) => {
      await fs.copy(src, dest, { overwrite: true });
    },

    createSymlink: async (target: CachePath, linkPath: string) => {
      if (await fs.pathExists(linkPath)) {
        await fs.remove(linkPath);
      }
      await fs.symlink(target, linkPath);
    },

    remove: async (filePath: string) => {
      await fs.remove(filePath);
    },

    readManifest: async (projectPath: ProjectPath) => {
      const manifestPath = `${projectPath}/${MANIFEST_FILE}`;
      if (!(await fs.pathExists(manifestPath))) {
        return null;
      }
      const raw = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(raw) as ProjectManifest;
    },

    writeManifest: async (projectPath: ProjectPath, manifest: ProjectManifest) => {
      const manifestPath = `${projectPath}/${MANIFEST_FILE}`;
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    },

    exists: async (filePath: string) => {
      return fs.pathExists(filePath);
    },

    readDir: async (dirPath: string) => {
      return fs.readdir(dirPath);
    },

    mkdir: async (dirPath: string) => {
      await fs.ensureDir(dirPath);
    },

    isDirectory: async (dirPath: string) => {
      if (!(await fs.pathExists(dirPath))) {
        return false;
      }
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    },

    isSymlink: async (linkPath: string) => {
      if (!(await fs.pathExists(linkPath))) {
        return false;
      }
      const stat = await fs.lstat(linkPath);
      return stat.isSymbolicLink();
    },

    resolveSymlink: async (linkPath: string) => {
      return fs.readlink(linkPath);
    },
  };
}

export function getManifestPath(projectPath: ProjectPath): string {
  return `${projectPath}/${MANIFEST_FILE}`;
}