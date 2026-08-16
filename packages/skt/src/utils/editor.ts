import { spawn } from "node:child_process";

/**
 * 起 VS Code 并等它关闭。
 *
 * Windows 上 code 是 .cmd 包装，必须走 shell 才找得到；
 * 非零退出码不当失败 —— 用户直接关窗口时 code 也可能返回非零，
 * 但那不代表操作失败，改动由调用方读文件确认。
 */
function runCode(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const editor = spawn("code", args, { shell: true });
    editor.on("close", () => resolve());
    editor.on("error", (error) => reject(error));
  });
}

/** 三路合并编辑器 */
export async function openMergeEditor(
  oursPath: string,
  theirsPath: string,
  basePath: string,
  outputPath: string
): Promise<void> {
  await runCode([
    "--wait",
    "--merge",
    oursPath,
    theirsPath,
    basePath,
    outputPath,
  ]);
}

/** 左右对照视图，等用户关闭窗口 */
export async function openDiff(left: string, right: string): Promise<void> {
  await runCode(["--wait", "--diff", left, right]);
}

export async function openFile(filePath: string): Promise<void> {
  await runCode(["--wait", filePath]);
}

/** code 命令是否可用 —— 不可用时要给出可执行的替代提示 */
export async function hasEditor(): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const probe = spawn("code", ["--version"], { shell: true });
      probe.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`code --version 退出码 ${code}`));
      });
      probe.on("error", reject);
    });
    return true;
  } catch {
    return false;
  }
}
