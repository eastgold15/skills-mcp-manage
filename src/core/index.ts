import { SkillMeta, ProjectManifest, RuntimeDependencies, SkillId, ProjectPath, CachePath } from '../types';

export async function scanCacheDirectory(cacheRoot: string, deps: RuntimeDependencies): Promise<SkillMeta[]> {
  const { fs, git } = deps;
  const result: SkillMeta[] = [];

  if (!(await fs.exists(cacheRoot))) {
    return result;
  }

  const entries = await fs.readDir(cacheRoot);

  for (const entry of entries) {
    const skillPath = `${cacheRoot}/${entry}`;
    if (!(await fs.isDirectory(skillPath))) {
      continue;
    }

    const gitDir = `${skillPath}/.git`;
    if (!(await fs.exists(gitDir))) {
      continue;
    }

    try {
      const remotes = await git.getRemotes(skillPath);
      const branch = await git.getBranch(skillPath);
      const hasChanges = await git.hasUncommittedChanges(skillPath);
      const lastCommit = await git.getLastCommit(skillPath);

      result.push({
        id: entry,
        path: skillPath,
        remotes: {
          origin: remotes.origin || '',
          upstream: remotes.upstream,
        },
        currentBranch: branch,
        hasUncommittedChanges: hasChanges,
        lastCommit,
      });
    } catch {
      continue;
    }
  }

  return result;
}

export async function checkUpstreamBehind(meta: SkillMeta, deps: RuntimeDependencies): Promise<number | null> {
  const { git } = deps;

  if (!meta.remotes.upstream) {
    return null;
  }

  try {
    await git.fetchUpstream(meta.path);
    return 0;
  } catch {
    return null;
  }
}

export function resolveProjectSkills(manifest: ProjectManifest): ProjectManifest['skills'] {
  return manifest.skills;
}

export function isSkillUpToDate(local: SkillMeta, remote: SkillMeta): boolean {
  return local.lastCommit.hash === remote.lastCommit.hash;
}

export async function initCache(cacheRoot: string, deps: RuntimeDependencies): Promise<void> {
  const { fs, ui } = deps;
  await ui.showSpinner('初始化缓存目录', async () => {
    await fs.mkdir(cacheRoot);
  });
}

export async function listSkills(cacheRoot: string, deps: RuntimeDependencies): Promise<void> {
  const { ui } = deps;
  const skills = await ui.showSpinner('扫描缓存目录', async () => scanCacheDirectory(cacheRoot, deps));

  if (skills.length === 0) {
    await ui.showInfo('缓存目录为空');
    return;
  }

  await ui.showTable({
    headers: ['ID', '分支', '上游', '未提交变更', '最近提交'],
    data: skills,
    format: (skill) => [
      skill.id,
      skill.currentBranch,
      skill.remotes.upstream ? '✓' : '✗',
      skill.hasUncommittedChanges ? '✓' : '✗',
      `${skill.lastCommit.hash.substring(0, 7)} - ${skill.lastCommit.message.substring(0, 30)}`,
    ],
  });
}

export async function addUpstream(skillId: SkillId, cacheRoot: string, deps: RuntimeDependencies): Promise<void> {
  const { fs, git, ui } = deps;
  const skillPath = `${cacheRoot}/${skillId}`;

  if (!(await fs.exists(skillPath))) {
    await ui.showError(`Skill ${skillId} 不存在`);
    return;
  }

  const upstreamUrl = await ui.showTextInput({ message: '输入上游仓库 URL:' });
  if (!upstreamUrl) {
    await ui.showError('URL 不能为空');
    return;
  }

  await ui.showSpinner(`为 ${skillId} 添加上游`, async () => {
    await git.addRemote(skillPath, 'upstream', upstreamUrl);
  });

  await ui.showSuccess(`已为 ${skillId} 添加上游: ${upstreamUrl}`);
}

export async function installSkillToProject(
  skillId: SkillId,
  projectPath: ProjectPath,
  installType: 'copy' | 'symlink',
  cacheRoot: string,
  deps: RuntimeDependencies
): Promise<void> {
  const { fs, git, ui } = deps;
  const sourcePath = `${cacheRoot}/${skillId}`;

  if (!(await fs.exists(sourcePath))) {
    await ui.showError(`Skill ${skillId} 不存在于缓存中`);
    return;
  }

  const targetDir = `${projectPath}/skills`;
  await fs.mkdir(targetDir);
  const targetPath = `${targetDir}/${skillId}`;

  const headCommit = await git.getHeadCommit(sourcePath);

  await ui.showSpinner(`安装 ${skillId} 到项目`, async () => {
    if (installType === 'symlink') {
      await fs.createSymlink(sourcePath, targetPath);
    } else {
      await fs.copyDir(sourcePath, targetPath);
    }
  });

  let manifest = (await fs.readManifest(projectPath)) || { version: 1 as const, skills: [] };

  const existingIndex = manifest.skills.findIndex((s) => s.skillId === skillId);
  if (existingIndex >= 0) {
    manifest.skills[existingIndex] = {
      skillId,
      installType,
      sourcePath,
      targetPath: `skills/${skillId}`,
      pinnedCommit: headCommit,
    };
  } else {
    manifest.skills.push({
      skillId,
      installType,
      sourcePath,
      targetPath: `skills/${skillId}`,
      pinnedCommit: headCommit,
    });
  }

  await fs.writeManifest(projectPath, manifest);
  await ui.showSuccess(`已安装 ${skillId}（${installType}）`);
}

export async function syncAll(projectPath: ProjectPath, cacheRoot: string, deps: RuntimeDependencies): Promise<{
  installed: string[];
  conflicts: string[];
}> {
  const { fs, ui } = deps;
  const manifest = await fs.readManifest(projectPath);

  if (!manifest) {
    await ui.showError('项目清单文件不存在');
    return { installed: [], conflicts: [] };
  }

  const results = { installed: [] as string[], conflicts: [] as string[] };

  for (const entry of manifest.skills) {
    try {
      await installSkillToProject(entry.skillId, projectPath, entry.installType, cacheRoot, deps);
      results.installed.push(entry.skillId);
    } catch {
      results.conflicts.push(entry.skillId);
    }
  }

  await ui.showSummary(results.installed.map((id) => ({ id, status: 'success' as const })));
  return results;
}

export async function updateSkill(
  skillId: SkillId,
  cacheRoot: string,
  deps: RuntimeDependencies
): Promise<{ success: boolean; conflicts: string[] }> {
  const { fs, git, ui } = deps;
  const skillPath = `${cacheRoot}/${skillId}`;

  if (!(await fs.exists(skillPath))) {
    await ui.showError(`Skill ${skillId} 不存在`);
    return { success: false, conflicts: [] };
  }

  const skills = await scanCacheDirectory(cacheRoot, deps);
  const skill = skills.find((s) => s.id === skillId);
  if (!skill || !skill.remotes.upstream) {
    await ui.showError(`Skill ${skillId} 未配置上游`);
    return { success: false, conflicts: [] };
  }

  await ui.showSpinner(`拉取上游更新`, async () => {
    await git.fetchUpstream(skillPath);
  });

  const mergeResult = await ui.showSpinner(`合并上游 ${skill.currentBranch}`, async () => {
    return git.mergeUpstream(skillPath, skill.currentBranch);
  });

  if (!mergeResult.merged && mergeResult.conflictFiles.length > 0) {
    const choice = await ui.showConflictTree(mergeResult.conflictFiles);

    switch (choice) {
      case 'ours':
        await ui.showSpinner('使用本地版本', async () => {
          await git.checkoutOurs(skillPath, mergeResult.conflictFiles);
          await git.commit(skillPath, `Merge upstream/${skill.currentBranch} (ours)`);
        });
        break;
      case 'theirs':
        await ui.showSpinner('使用上游版本', async () => {
          await git.checkoutTheirs(skillPath, mergeResult.conflictFiles);
          await git.commit(skillPath, `Merge upstream/${skill.currentBranch} (theirs)`);
        });
        break;
      case 'abort':
        await ui.showSpinner('中止合并', async () => {
          await git.abortMerge(skillPath);
        });
        return { success: false, conflicts: mergeResult.conflictFiles };
      case 'open-editor':
        await ui.showInfo('请手动解决冲突后再继续');
        return { success: false, conflicts: mergeResult.conflictFiles };
    }
  }

  await ui.showSuccess(`更新完成`);
  return { success: true, conflicts: [] };
}

export async function publishToGitHub(
  skillId: SkillId,
  cacheRoot: string,
  githubOrg: string,
  deps: RuntimeDependencies
): Promise<void> {
  const { fs, git, ui } = deps;
  const skillPath = `${cacheRoot}/${skillId}`;

  if (!(await fs.exists(skillPath))) {
    await ui.showError(`Skill ${skillId} 不存在`);
    return;
  }

  const remotes = await git.getRemotes(skillPath);

  if (!remotes.origin) {
    const repoName = await ui.showTextInput({ message: '输入 GitHub 仓库名称:' });
    if (!repoName) {
      await ui.showError('仓库名称不能为空');
      return;
    }

    const originUrl = `https://github.com/${githubOrg}/${repoName}.git`;
    await ui.showSpinner('添加 origin 远程', async () => {
      await git.addRemote(skillPath, 'origin', originUrl);
    });
  }

  await ui.showSpinner('推送到 GitHub', async () => {
    await git.pushToOrigin(skillPath);
  });

  await ui.showSuccess(`已发布到 GitHub`);
}

export async function removeSkill(skillId: SkillId, cacheRoot: string, deps: RuntimeDependencies): Promise<void> {
  const { fs, ui } = deps;
  const skillPath = `${cacheRoot}/${skillId}`;

  if (!(await fs.exists(skillPath))) {
    await ui.showError(`Skill ${skillId} 不存在`);
    return;
  }

  const confirmed = await ui.showConfirm(`确定删除 ${skillId} 吗？`);
  if (!confirmed) {
    return;
  }

  await ui.showSpinner(`删除 ${skillId}`, async () => {
    await fs.remove(skillPath);
  });

  await ui.showSuccess(`已删除 ${skillId}`);
}

export async function uninstallSkillFromProject(
  skillId: SkillId,
  projectPath: ProjectPath,
  deps: RuntimeDependencies
): Promise<void> {
  const { fs, ui } = deps;
  const manifest = await fs.readManifest(projectPath);

  if (!manifest) {
    await ui.showError('项目清单文件不存在');
    return;
  }

  const entryIndex = manifest.skills.findIndex((s) => s.skillId === skillId);
  if (entryIndex < 0) {
    await ui.showError(`项目中未安装 ${skillId}`);
    return;
  }

  const entry = manifest.skills[entryIndex];
  if (!entry) {
    await ui.showError(`项目中未安装 ${skillId}`);
    return;
  }
  const targetPath = `${projectPath}/${entry.targetPath}`;

  await ui.showSpinner(`卸载 ${skillId}`, async () => {
    await fs.remove(targetPath);
    manifest.skills.splice(entryIndex, 1);
    await fs.writeManifest(projectPath, manifest);
  });

  await ui.showSuccess(`已卸载 ${skillId}`);
}

export async function listProjectSkills(projectPath: ProjectPath, deps: RuntimeDependencies): Promise<void> {
  const { fs, ui } = deps;
  const manifest = await fs.readManifest(projectPath);

  if (!manifest) {
    await ui.showInfo('项目清单文件不存在');
    return;
  }

  if (manifest.skills.length === 0) {
    await ui.showInfo('项目中未安装任何 Skill');
    return;
  }

  await ui.showTable({
    headers: ['ID', '安装方式', '目标路径', '锁定版本'],
    data: manifest.skills,
    format: (entry) => [
      entry.skillId,
      entry.installType === 'copy' ? '复制' : '软链接',
      entry.targetPath,
      entry.pinnedCommit ? entry.pinnedCommit.substring(0, 7) : '未锁定',
    ],
  });
}

export async function configure(deps: RuntimeDependencies): Promise<void> {
  const { ui } = deps;
  const { getConfig, saveConfig } = await import('../config');

  const config = await getConfig();

  const cacheRoot = await ui.showTextInput({
    message: `缓存根目录 (当前: ${config.cacheRoot})`,
  });

  const githubOrg = await ui.showTextInput({
    message: `GitHub 组织/用户名 (当前: ${config.githubOrg})`,
  });

  const githubToken = await ui.showTextInput({
    message: 'GitHub Token (留空不修改)',
    mask: true,
  });

  if (cacheRoot) config.cacheRoot = cacheRoot;
  if (githubOrg) config.githubOrg = githubOrg;
  if (githubToken) config.githubToken = githubToken;

  await saveConfig(config);
  await ui.showSuccess('配置已保存');
}

export async function showConfig(deps: RuntimeDependencies): Promise<void> {
  const { ui } = deps;
  const { getConfig } = await import('../config');

  const config = await getConfig();

  await ui.showTable({
    headers: ['配置项', '值'],
    data: [
      { key: '缓存根目录', value: config.cacheRoot },
      { key: 'GitHub 组织', value: config.githubOrg },
      { key: 'GitHub Token', value: config.githubToken ? '***' : '未设置' },
    ],
    format: (item) => [item.key, item.value],
  });
}