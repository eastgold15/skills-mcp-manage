import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { lstat } from "node:fs/promises";
import { ensureDir, readFile, remove, writeFile } from "@visulima/fs";
import { join } from "@visulima/path";
import {
  adoptOutside,
  findDivergences,
  linkToLibrary,
  touchedFiles,
} from "../src/core/divergence";
import { normalizeOne } from "../src/core/normalize";
import { libraryDir, setAgentsRoot } from "../src/core/paths";
import type { ScanHit } from "../src/core/types";

const ROOT = join(import.meta.dir, "..", ".test-tmp", "divergence");
const AGENTS = join(ROOT, "agents");
const DISK = join(ROOT, "disk");

async function makeSkill(
  path: string,
  files: Record<string, string>
): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const full = join(path, relative);
    await ensureDir(join(full, ".."));
    await writeFile(full, content);
  }
}

function hitFor(path: string, id: string): ScanHit {
  return { adoptable: true, id, inLibrary: false, isLink: false, path };
}

beforeEach(async () => {
  await remove(ROOT);
  await ensureDir(ROOT);
  setAgentsRoot(AGENTS);
});

afterAll(async () => {
  setAgentsRoot(undefined);
  await remove(ROOT);
});

describe("findDivergences 定位待决差异", () => {
  it("内容一致的不算差异", async () => {
    await makeSkill(join(libraryDir(), "same"), { "SKILL.md": "一样\n" });
    const outside = join(DISK, "proj", ".claude", "skills", "same");
    await makeSkill(outside, { "SKILL.md": "一样\n" });

    const result = await findDivergences([hitFor(outside, "same")]);

    expect(result).toEqual([]);
  });

  it("本体库没有同名的不算差异（那是待收编，不是待决）", async () => {
    const outside = join(DISK, "proj", ".claude", "skills", "fresh");
    await makeSkill(outside, { "SKILL.md": "新的\n" });

    const result = await findDivergences([hitFor(outside, "fresh")]);

    expect(result).toEqual([]);
  });

  it("分类出内容不同、单边独有的文件", async () => {
    await makeSkill(join(libraryDir(), "mix"), {
      "refs/only-lib.md": "只在库里\n",
      "SKILL.md": "本体库版\n",
      "shared.md": "一样的\n",
    });
    const outside = join(DISK, "proj", ".claude", "skills", "mix");
    await makeSkill(outside, {
      "refs/only-out.md": "只在项目里\n",
      "SKILL.md": "项目版\n",
      "shared.md": "一样的\n",
    });

    const [result] = await findDivergences([hitFor(outside, "mix")]);

    expect(result?.changed).toEqual(["SKILL.md"]);
    expect(result?.onlyInLibrary).toEqual(["refs/only-lib.md"]);
    expect(result?.onlyOutside).toEqual(["refs/only-out.md"]);
    // shared.md 一致，不出现在任何分类里
    expect(touchedFiles(result!)).toEqual([
      "refs/only-lib.md",
      "refs/only-out.md",
      "SKILL.md",
    ]);
  });

  it("链接不算差异（已纳管或属于别的工具）", async () => {
    await makeSkill(join(libraryDir(), "linked"), { "SKILL.md": "内容\n" });
    const result = await findDivergences([
      {
        adoptable: true,
        id: "linked",
        inLibrary: false,
        isLink: true,
        path: join(DISK, "proj", ".claude", "skills", "linked"),
        target: join(libraryDir(), "linked"),
      },
    ]);

    expect(result).toEqual([]);
  });

  it("同一个 id 的多处差异都列出", async () => {
    await makeSkill(join(libraryDir(), "dup"), { "SKILL.md": "库版\n" });
    const a = join(DISK, "a", ".claude", "skills", "dup");
    const b = join(DISK, "b", ".claude", "skills", "dup");
    await makeSkill(a, { "SKILL.md": "甲版\n" });
    await makeSkill(b, { "SKILL.md": "乙版\n" });

    const result = await findDivergences([hitFor(a, "dup"), hitFor(b, "dup")]);

    expect(result).toHaveLength(2);
  });
});

describe("adoptOutside 用项目那份覆盖本体库", () => {
  it("覆盖后本体库内容变为项目那份", async () => {
    await makeSkill(join(libraryDir(), "take"), {
      "SKILL.md": "旧的\n",
      "stale.md": "该被删掉\n",
    });
    const outside = join(DISK, "proj", ".claude", "skills", "take");
    await makeSkill(outside, { "SKILL.md": "新的\n" });

    const [divergence] = await findDivergences([hitFor(outside, "take")]);
    await adoptOutside(divergence!);

    expect(await readFile(join(libraryDir(), "take", "SKILL.md"))).toBe(
      "新的\n"
    );
    // 覆盖是整目录替换，本体库里多出来的文件不该留下
    const after = await findDivergences([hitFor(outside, "take")]);
    expect(after).toEqual([]);
  });
});

/**
 * 真实 bug 的回归防线。
 *
 * agent diff 里选「保留本体库这份」没有生效 —— 因为它走了 normalizeOne，
 * 而后者的 diverged 守卫（内容不同就停手）是给自动批量用的：无人决策时
 * 必须保守。可走到 diff 的决策分支意味着用户已明确表态，再拦一次就是
 * 把用户的决定挡掉，表现为「选了但没反应，再跑还是 11 处」。
 */
describe("已决定后不再被 diverged 守卫拦下", () => {
  it("保留本体库：内容不同也要换成链接", async () => {
    await makeSkill(join(libraryDir(), "keep"), { "SKILL.md": "本体库版\n" });
    const outside = join(DISK, "proj", ".claude", "skills", "keep");
    await makeSkill(outside, { "SKILL.md": "项目版（要丢弃）\n" });

    const [divergence] = await findDivergences([hitFor(outside, "keep")]);
    expect(divergence).toBeDefined();

    // 关键：normalizeOne 在这种情况下会报 diverged 拒绝动手
    expect((await normalizeOne(hitFor(outside, "keep"))).outcome).toBe(
      "diverged"
    );

    // linkToLibrary 则执行用户的决定
    await linkToLibrary(divergence!);

    expect((await lstat(outside)).isSymbolicLink()).toBe(true);
    // 读到的是本体库的内容，项目那份已丢弃
    expect(await readFile(join(outside, "SKILL.md"))).toBe("本体库版\n");
    // 本体库自身没被动过
    expect(await readFile(join(libraryDir(), "keep", "SKILL.md"))).toBe(
      "本体库版\n"
    );
  });

  it("处理后差异清单里不再出现（这正是 bug 的表现）", async () => {
    await makeSkill(join(libraryDir(), "gone"), { "SKILL.md": "库版\n" });
    const outside = join(DISK, "proj", ".claude", "skills", "gone");
    await makeSkill(outside, { "SKILL.md": "别的\n" });

    const [divergence] = await findDivergences([hitFor(outside, "gone")]);
    await linkToLibrary(divergence!);

    // 已变成链接 → findDivergences 会跳过链接，清单为空
    const after = await findDivergences([
      {
        adoptable: true,
        id: "gone",
        inLibrary: false,
        isLink: true,
        path: outside,
        target: join(libraryDir(), "gone"),
      },
    ]);
    expect(after).toEqual([]);
  });

  it("用项目那份覆盖：本体库变成项目内容，两处都指向它", async () => {
    await makeSkill(join(libraryDir(), "take2"), { "SKILL.md": "旧库版\n" });
    const outside = join(DISK, "proj", ".claude", "skills", "take2");
    await makeSkill(outside, { "SKILL.md": "项目版（要保留）\n" });

    const [divergence] = await findDivergences([hitFor(outside, "take2")]);
    await adoptOutside(divergence!);
    await linkToLibrary(divergence!);

    expect(await readFile(join(libraryDir(), "take2", "SKILL.md"))).toBe(
      "项目版（要保留）\n"
    );
    expect((await lstat(outside)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(outside, "SKILL.md"))).toBe(
      "项目版（要保留）\n"
    );
  });
});

describe("同 id 多份时逐轮重算", () => {
  it("处理完一处后，另一处的差异要基于新的本体库内容", async () => {
    await makeSkill(join(libraryDir(), "tri"), { "SKILL.md": "版本A\n" });
    const first = join(DISK, "one", ".claude", "skills", "tri");
    const second = join(DISK, "two", ".claude", "skills", "tri");
    await makeSkill(first, { "SKILL.md": "版本B\n" });
    await makeSkill(second, { "SKILL.md": "版本B\n" });

    // 起初两处都与本体库（版本A）不同
    const before = await findDivergences([
      hitFor(first, "tri"),
      hitFor(second, "tri"),
    ]);
    expect(before).toHaveLength(2);

    // 用第一处覆盖本体库 → 本体库变成版本B
    await adoptOutside(before[0]!);

    // 第二处也是版本B，现在应该已无差异 —— 若用旧快照就会误报
    const after = await findDivergences([hitFor(second, "tri")]);
    expect(after).toEqual([]);
  });

  it("覆盖本体库后，第二处可直接收编为链接", async () => {
    await makeSkill(join(libraryDir(), "conv"), { "SKILL.md": "旧\n" });
    const first = join(DISK, "one", ".claude", "skills", "conv");
    const second = join(DISK, "two", ".claude", "skills", "conv");
    await makeSkill(first, { "SKILL.md": "统一版\n" });
    await makeSkill(second, { "SKILL.md": "统一版\n" });

    const [divergence] = await findDivergences([hitFor(first, "conv")]);
    await adoptOutside(divergence!);

    // 两处都换成链接，散落彻底消除
    const r1 = await normalizeOne(hitFor(first, "conv"));
    const r2 = await normalizeOne(hitFor(second, "conv"));

    expect(r1.outcome).toBe("linked");
    expect(r2.outcome).toBe("linked");
    expect((await lstat(first)).isSymbolicLink()).toBe(true);
    expect((await lstat(second)).isSymbolicLink()).toBe(true);
    // 通过任一链接都读到统一内容
    expect(await readFile(join(first, "SKILL.md"))).toBe("统一版\n");
    expect(await readFile(join(second, "SKILL.md"))).toBe("统一版\n");
  });
});
