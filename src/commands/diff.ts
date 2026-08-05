import { isAccessible } from "@visulima/fs";
import { join } from "@visulima/path";
import {
  adoptOutside,
  type Divergence,
  findDivergences,
  linkToLibrary,
  touchedFiles,
} from "../core/divergence";
import { readScanCache, reevaluate } from "../core/scan";
import { colors } from "../ui/colors";
import {
  askSelect,
  PromptCancelled,
  printSuccess,
  printWarning,
} from "../ui/prompts";
import { hasEditor, openDiff } from "../utils/editor";
import { calculateDirectoryHash } from "../utils/hash";

export interface DiffOptions {
  /** 只打印差异清单，不进入交互 */
  listOnly?: boolean;
  /** 只处理这个 id */
  only?: string;
}

/** 打印一处差异的文件级明细 */
function describe(
  divergence: Divergence,
  index: number,
  total: number,
  siblings = 0
): void {
  console.log("");
  console.log(colors.info(`[${index}/${total}] ${divergence.id}`));
  if (siblings > 0) {
    // 同 id 多处时顺序有实质影响：收敛为一份的话，
    // 处理完这份本体库就变了，后面几份要对照新的内容
    console.log(
      colors.warning(
        `  此 skill 另有 ${siblings} 处待决 —— 处理完这份后本体库内容会变，届时会重新比对`
      )
    );
  }
  console.log(colors.gray(`  本体库  ${divergence.library}`));
  console.log(colors.gray(`  项目    ${divergence.outside}`));

  if (divergence.changed.length > 0) {
    console.log(colors.warning(`  内容不同：${divergence.changed.join("、")}`));
  }
  if (divergence.onlyInLibrary.length > 0) {
    console.log(
      colors.gray(`  仅本体库有：${divergence.onlyInLibrary.join("、")}`)
    );
  }
  if (divergence.onlyOutside.length > 0) {
    console.log(
      colors.gray(`  仅项目有：${divergence.onlyOutside.join("、")}`)
    );
  }
}

type Decision = "editor" | "keep-library" | "take-outside" | "skip";

async function ask(): Promise<Decision> {
  return await askSelect<Decision>("怎么处理？", [
    {
      hint: "改完保存关窗，回来确认",
      label: "打开 VS Code 对照编辑",
      value: "editor",
    },
    {
      hint: "项目那份换成链接，其内容丢弃",
      label: "保留本体库这份",
      value: "keep-library",
    },
    {
      hint: "本体库被覆盖，项目换成链接",
      label: "用项目这份覆盖本体库",
      value: "take-outside",
    },
    { hint: "留着下次再说", label: "跳过", value: "skip" },
  ]);
}

/**
 * 打开编辑器逐个文件对照。
 *
 * 一次只开一个文件 —— code --diff 只接受两个路径，多文件得逐个来。
 * 只对「两边都有但内容不同」的开；单边独有的文件没有对照对象。
 */
async function reviewInEditor(divergence: Divergence): Promise<void> {
  const files = divergence.changed;
  if (files.length === 0) {
    printWarning("没有可对照的文件（差异都是单边独有），请直接选保留哪份");
    return;
  }

  for (const relative of files) {
    console.log(colors.gray(`  正在打开 ${relative}...`));
    await openDiff(
      join(divergence.library, relative),
      join(divergence.outside, relative)
    );
  }
}

/** 编辑器关闭后重新比对，据实汇报 */
async function settle(divergence: Divergence): Promise<void> {
  const [library, outside] = await Promise.all([
    calculateDirectoryHash(divergence.library),
    calculateDirectoryHash(divergence.outside),
  ]);

  if (library === outside) {
    // 两边一样了 —— 换链接，散落消除
    await linkToLibrary(divergence);
    printSuccess(`${divergence.id}：两边已一致，项目那份已换为链接`);
    return;
  }

  printWarning(
    `${divergence.id}：两边仍不一致，未做收编。可再次运行 agent diff 继续处理`
  );
}

/**
 * 执行用户的决定。
 *
 * 这里一律用 linkToLibrary 而非 normalizeOne —— 后者的 diverged 守卫
 * 是给自动批量用的（无人决策时必须保守），走到这里用户已经明确表态，
 * 再拦一次就等于把决定挡掉，表现为「选了保留本体库但没生效」。
 */
async function apply(
  divergence: Divergence,
  decision: Decision
): Promise<void> {
  if (decision === "skip") {
    return;
  }

  if (decision === "editor") {
    await reviewInEditor(divergence);
    await settle(divergence);
    return;
  }

  if (decision === "take-outside") {
    // 先把本体库换成项目那份，再让项目指向它
    await adoptOutside(divergence);
    await linkToLibrary(divergence);
    printSuccess(`${divergence.id}：已用项目那份覆盖本体库，原位置换为链接`);
    return;
  }

  // keep-library：本体库已是想要的内容，丢弃项目那份换成链接
  await linkToLibrary(divergence);
  printSuccess(`${divergence.id}：已保留本体库这份，项目那份换为链接`);
}

/** 单份内容的实时差异，返回 null 表示已无差异 */
async function refresh(divergence: Divergence): Promise<Divergence | null> {
  const fresh = await findDivergences([
    {
      adoptable: true,
      id: divergence.id,
      inLibrary: false,
      isLink: false,
      path: divergence.outside,
    },
  ]);
  return fresh[0] ?? null;
}

/** 收集待决差异，已过滤 --only */
async function collect(options: DiffOptions): Promise<Divergence[] | null> {
  const cache = await readScanCache();
  if (!cache) {
    printWarning("还没有扫描缓存，先跑 agent scan");
    return null;
  }

  const hits = await reevaluate(cache);
  const all = await findDivergences(hits);
  const filtered = options.only
    ? all.filter((d) => d.id === options.only)
    : all;

  if (filtered.length === 0) {
    if (options.only) {
      printWarning(`没有找到 ${options.only} 的待决差异`);
    } else {
      printSuccess("没有待决差异 —— 所有同名 skill 内容都一致");
    }
    return null;
  }
  return filtered;
}

/** 只打印清单 */
function listAll(divergences: Divergence[]): void {
  const counts = new Map<string, number>();
  for (const d of divergences) {
    counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
  }
  for (const [index, divergence] of divergences.entries()) {
    describe(
      divergence,
      index + 1,
      divergences.length,
      (counts.get(divergence.id) ?? 1) - 1
    );
    console.log(
      colors.gray(`  涉及 ${touchedFiles(divergence).length} 个文件`)
    );
  }
  console.log("");
  console.log(colors.gray("去掉 --list 进入逐个处理"));
}

/** 处理一处，返回是否算作已决 */
async function handleOne(
  stale: Divergence,
  index: number,
  divergences: Divergence[]
): Promise<boolean> {
  // 实时重算：本体库可能已被前几轮改过
  const divergence = await refresh(stale);
  if (!divergence) {
    // 内容已一致（前几轮改动的结果），换链接即可，不必再问
    await linkToLibrary(stale);
    printSuccess(`${stale.id}（${stale.outside}）已与本体库一致，换为链接`);
    return true;
  }

  const siblings = divergences.filter(
    (d, i) => d.id === divergence.id && i > index
  ).length;
  describe(divergence, index + 1, divergences.length, siblings);

  const decision = await ask();
  await apply(divergence, decision);
  return decision !== "skip";
}

/**
 * 逐个处理与本体库同名但内容不同的位置。
 *
 * 这是 scan --normalize 报 diverged 之后的下一步 —— 那里拒绝动手，
 * 这里给出比对与决定的手段。
 *
 * 每轮实时重算差异：同一个 id 可能有多处（实测 find-skills 有 3 处，
 * 四个版本互不相同），处理完一处本体库就变了，后面几处必须对照新内容。
 */
export async function diff(options: DiffOptions = {}): Promise<void> {
  const divergences = await collect(options);
  if (!divergences) {
    return;
  }

  console.log(colors.info(`${divergences.length} 处与本体库同名但内容不同`));

  if (options.listOnly) {
    listAll(divergences);
    return;
  }

  if (!(await hasEditor())) {
    printWarning(
      "找不到 code 命令，编辑器对照不可用。仍可选择保留哪份，或先装 VS Code 的 shell 命令"
    );
  }

  let handled = 0;
  for (const [index, stale] of divergences.entries()) {
    // 前一轮可能已把它处理掉（同 id 多处时）
    if (!(await isAccessible(stale.outside))) {
      continue;
    }

    try {
      if (await handleOne(stale, index, divergences)) {
        handled += 1;
      }
    } catch (error) {
      if (error instanceof PromptCancelled) {
        console.log(colors.gray(`已中断。已处理 ${handled} 处，其余保持原样`));
        return;
      }
      throw error;
    }
  }

  console.log("");
  printSuccess(`处理完毕：${handled}/${divergences.length} 处已决`);
}
