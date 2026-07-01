import { defineCommand } from 'boune';
import { RuntimeDependencies } from '../types';

export function createCommands(deps: RuntimeDependencies) {
  const { config } = deps;

  const init = defineCommand({
    name: 'init',
    description: '初始化 Agent 环境',
    action: async () => {
      const { initCache } = await import('../core');
      const { initConfig } = await import('../config');
      await initConfig();
      await initCache(config.cacheRoot, deps);
    },
  });

  const list = defineCommand({
    name: 'list',
    description: '列出缓存中所有 Skills',
    action: async () => {
      const { listSkills } = await import('../core');
      await listSkills(config.cacheRoot, deps);
    },
  });

  const install = defineCommand({
    name: 'install',
    description: '安装 Skill 到当前项目',
    arguments: {
      skillId: { type: 'string', required: true, description: 'Skill ID' },
    },
    options: {
      copy: { type: 'boolean', short: 'c', description: '使用复制而非软链接' },
    },
    action: async ({ args, options }) => {
      const { installSkillToProject } = await import('../core');
      const installType = options.copy ? 'copy' : 'symlink';
      await installSkillToProject(args.skillId, process.cwd(), installType, config.cacheRoot, deps);
    },
  });

  const uninstall = defineCommand({
    name: 'uninstall',
    description: '卸载项目中的 Skill',
    arguments: {
      skillId: { type: 'string', required: true, description: 'Skill ID' },
    },
    action: async ({ args }) => {
      const { uninstallSkillFromProject } = await import('../core');
      await uninstallSkillFromProject(args.skillId, process.cwd(), deps);
    },
  });

  const sync = defineCommand({
    name: 'sync',
    description: '同步当前项目的所有依赖',
    action: async () => {
      const { syncAll } = await import('../core');
      await syncAll(process.cwd(), config.cacheRoot, deps);
    },
  });

  const update = defineCommand({
    name: 'update',
    description: '更新缓存中的 Skill',
    arguments: {
      skillId: { type: 'string', required: true, description: 'Skill ID' },
    },
    action: async ({ args }) => {
      const { updateSkill } = await import('../core');
      await updateSkill(args.skillId, config.cacheRoot, deps);
    },
  });

  const publish = defineCommand({
    name: 'publish',
    description: '将自定义 Skill 发布到 GitHub',
    arguments: {
      skillId: { type: 'string', required: true, description: 'Skill ID' },
    },
    options: {
      org: { type: 'string', short: 'o', description: 'GitHub 组织名' },
    },
    action: async ({ args, options }) => {
      const { publishToGitHub } = await import('../core');
      const org = options.org || config.githubOrg || '';
      await publishToGitHub(args.skillId, config.cacheRoot, org, deps);
    },
  });

  const addUpstream = defineCommand({
    name: 'add-upstream',
    description: '为 Skill 添加上游远程地址',
    arguments: {
      skillId: { type: 'string', required: true, description: 'Skill ID' },
    },
    action: async ({ args }) => {
      const { addUpstream } = await import('../core');
      await addUpstream(args.skillId, config.cacheRoot, deps);
    },
  });

  const remove = defineCommand({
    name: 'remove',
    description: '移除缓存中的 Skill',
    arguments: {
      skillId: { type: 'string', required: true, description: 'Skill ID' },
    },
    action: async ({ args }) => {
      const { removeSkill } = await import('../core');
      await removeSkill(args.skillId, config.cacheRoot, deps);
    },
  });

  const projectList = defineCommand({
    name: 'project-list',
    description: '列出当前项目已安装的 Skill',
    action: async () => {
      const { listProjectSkills } = await import('../core');
      await listProjectSkills(process.cwd(), deps);
    },
  });

  const configCmd = defineCommand({
    name: 'config',
    description: '配置全局设置',
    action: async () => {
      const { configure } = await import('../core');
      await configure(deps);
    },
  });

  const configShow = defineCommand({
    name: 'config-show',
    description: '查看当前全局配置',
    action: async () => {
      const { showConfig } = await import('../core');
      await showConfig(deps);
    },
  });

  return {
    init,
    list,
    install,
    uninstall,
    sync,
    update,
    publish,
    'add-upstream': addUpstream,
    remove,
    'project-list': projectList,
    config: configCmd,
    'config-show': configShow,
  };
}