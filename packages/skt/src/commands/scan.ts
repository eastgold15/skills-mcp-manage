import { configFile } from "../core/config";
import { type NormalizeResult, normalizeAll } from "../core/normalize";
import {
  bystanders,
  conflicts,
  outsiders,
  readScanCache,
  reevaluate,
  scanAndCache,
} from "../core/scan";
import type { ScanHit } from "../core/types";
import { colors } from "../ui/colors";
import { printSuccess, printTable, printWarning } from "../ui/prompts";
import { withSpinner } from "../ui/spinner";

export interface ScanOptions {
  /** 真正执行归一化（默认只预演） */
  apply?: boolean;
  /** 输出 JSON */
  asJson?: boolean;
  /** 归一化：收编本体库外的 skill */
  normalize?: boolean;
  /** 只用缓存重新判定，不扫磁盘（改完配置后用） */
  reuse?: boolean;
  /** 指定扫描位置，省略则用配置里的 roots */
  roots?: string[];
}

function reportHits(hits: ScanHit[]): void {
  const outside = outsiders(hits);
  const others = bystanders(hits);
  const inLibrary = hits.filter((h) => h.inLibrary).length;

  console.log(
    colors.gray(
      `共扫到 ${hits.length} 处 SKILL.md：本体库内 ${inLibrary}，` +
        `待归一化 ${outside.length}，配置未认可 ${others.length}`
    )
  );
  console.log(colors.gray(`策略文件：${configFile()}`));

  if (outside.length === 0) {
    printSuccess("配置认可的 skill 都已在本体库中，无需归一化");
    if (others.length > 0) {
      console.log(
        colors.gray(
          `另有 ${others.length} 处未被 include 命中或被 exclude 挡掉。` +
            "若其中有你想纳管的，改配置后跑 agent scan --reuse"
        )
      );
    }
    return;
  }

  const rows = outside.map((hit) => [
    hit.id,
    hit.isLink ? colors.info("链接") : colors.warning("真实目录"),
    colors.gray(hit.path),
  ]);
  printTable(["ID", "形态", "位置"], rows);

  const dup = conflicts(hits);
  if (dup.size > 0) {
    printWarning(
      `${dup.size} 个 id 在本体库外有多处真实目录 —— 归一化只能留一份，` +
        "内容不同的会被跳过并报出，不会静默覆盖："
    );
    for (const [id, list] of dup) {
      console.log(colors.gray(`  ${id}：`));
      for (const hit of list) {
        console.log(colors.gray(`    ${hit.path}`));
      }
    }
  }

  const adoptable = outside.filter((h) => !h.isLink).length;
  if (adoptable > 0) {
    console.log(
      colors.gray(
        `\n${adoptable} 个真实目录待收编。先跑 agent scan --normalize 预演，确认后加 --apply`
      )
    );
  }
  if (others.length > 0) {
    console.log(
      colors.gray(`${others.length} 处配置未认可，已跳过（改配置可调整范围）`)
    );
  }
}

const OUTCOME_TEXT: Record<NormalizeResult["outcome"], string> = {
  adopted: "将收编并换为链接",
  already: "已是本体库链接",
  diverged: "同名但内容不同，跳过",
  external: "指向别处的链接，跳过",
  failed: "失败",
  linked: "内容一致，将换为链接",
};

function reportNormalize(results: NormalizeResult[], applied: boolean): void {
  if (results.length === 0) {
    printSuccess("没有需要归一化的位置");
    return;
  }

  const rows = results.map((r) => [
    r.id,
    OUTCOME_TEXT[r.outcome],
    colors.gray(r.reason ?? r.path),
  ]);
  printTable(["ID", "结果", "说明"], rows);

  const changed = results.filter(
    (r) => r.outcome === "adopted" || r.outcome === "linked"
  ).length;
  const diverged = results.filter((r) => r.outcome === "diverged");
  const failed = results.filter((r) => r.outcome === "failed");

  if (applied) {
    printSuccess(`已归一化 ${changed} 处`);
  } else {
    console.log(
      colors.gray(`预演：将归一化 ${changed} 处。确认无误后加 --apply 执行`)
    );
  }

  if (diverged.length > 0) {
    printWarning(
      `${diverged.length} 处与本体库同名但内容不同，未动 —— 请手动比对后决定保留哪份`
    );
  }
  if (failed.length > 0) {
    printWarning(`${failed.length} 处失败，详见上表`);
  }
}

/** 预演：不动文件，只推断每处会变成什么 */
function dryRun(hits: ScanHit[]): NormalizeResult[] {
  return outsiders(hits).map((hit) => {
    if (hit.isLink) {
      return {
        id: hit.id,
        outcome: hit.target?.includes(".agents") ? "already" : "external",
        path: hit.path,
      } as NormalizeResult;
    }
    // 预演不读内容，统一按「将收编」呈现；
    // 真正执行时才比哈希区分 adopted / linked / diverged
    return { id: hit.id, outcome: "adopted", path: hit.path };
  });
}

/** 取命中清单：--reuse 只重算配置判定，否则扫磁盘 */
async function gatherHits(options: ScanOptions): Promise<ScanHit[] | null> {
  if (options.reuse) {
    const cached = await readScanCache();
    if (!cached) {
      printWarning("还没有扫描缓存，先跑一次 agent scan");
      return null;
    }
    const hits = await reevaluate(cached);
    console.log(
      colors.gray(`用 ${cached.scannedAt} 的扫描结果重新判定（未重扫磁盘）`)
    );
    return hits;
  }

  const { cache } = await withSpinner(
    options.roots?.length
      ? `正在扫描 ${options.roots.length} 个指定位置`
      : "正在按配置扫描",
    () => scanAndCache(options.roots)
  );
  return cache.hits;
}

export async function scan(options: ScanOptions = {}): Promise<void> {
  const hits = await gatherHits(options);
  if (!hits) {
    return;
  }

  if (options.asJson) {
    console.log(JSON.stringify({ hits }, null, 2));
    return;
  }

  if (!options.normalize) {
    reportHits(hits);
    return;
  }

  if (options.apply) {
    const results = await withSpinner("正在归一化", () => normalizeAll(hits));
    reportNormalize(results, true);
    // 归一化改变了磁盘布局，重扫一次让缓存跟上
    await scanAndCache(options.roots);
    return;
  }

  reportNormalize(dryRun(hits), false);
}
