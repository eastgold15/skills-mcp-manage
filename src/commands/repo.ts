import { libraryDir } from "../core/paths";
import {
  checkpoint,
  initRepo,
  isRepo,
  libraryGit,
  repoStatus,
} from "../core/repo";
import { colors } from "../ui/colors";
import { printSuccess, printTable, printWarning } from "../ui/prompts";

export interface RepoOptions {
  /** 把当前改动提交为检查点 */
  commit?: string;
  /** 显示最近若干条提交 */
  log?: boolean;
}

/**
 * 本体库的版本管理。
 *
 * 有了 git，所有破坏性操作（skills add 覆盖、三路合并、归一化）
 * 都不再是「丢数据」，而是可 diff、可 revert 的提交。
 * 自己手改完也能看清动了什么。
 */
export async function repo(options: RepoOptions = {}): Promise<void> {
  if (!(await isRepo())) {
    const created = await initRepo();
    if (created) {
      printSuccess(`已把本体库纳入 git 管理（${created.commit.slice(0, 7)}）`);
      console.log(colors.gray(`  ${libraryDir()}`));
      console.log(
        colors.gray("  之后所有改动都可以 git diff 查看、git revert 回退")
      );
      return;
    }
  }

  if (options.commit) {
    const sha = await checkpoint(options.commit);
    if (sha) {
      printSuccess(`已提交检查点 ${sha.slice(0, 7)}`);
    } else {
      printWarning("没有待提交的改动");
    }
    return;
  }

  const status = await repoStatus();
  if (!status) {
    printWarning("本体库还不是 git 仓库，跑一次 agent repo 初始化");
    return;
  }

  console.log(colors.info("本体库版本状态"));
  console.log(colors.gray(`  ${libraryDir()}`));
  if (status.head) {
    console.log(colors.gray(`  HEAD  ${status.head.slice(0, 7)}`));
  }

  if (status.dirty) {
    printWarning(`${status.changedFiles} 个文件有未提交改动`);
    const diff = await libraryGit().diff(["--stat"]);
    console.log(colors.gray(diff.trimEnd()));
    console.log("");
    console.log(
      colors.gray('用 agent repo --commit "说明" 提交，或自行 git 操作')
    );
  } else {
    printSuccess("工作区干净");
  }

  if (options.log) {
    const log = await libraryGit().log({ maxCount: 10 });
    console.log("");
    printTable(
      ["提交", "时间", "说明"],
      log.all.map((entry) => [
        colors.gray(entry.hash.slice(0, 7)),
        colors.gray(entry.date.slice(0, 10)),
        entry.message,
      ])
    );
  }
}
