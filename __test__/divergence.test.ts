import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { lstat } from "node:fs/promises";
import { ensureDir, readFile, remove, writeFile } from "@visulima/fs";
import { join } from "@visulima/path";
import {
  adoptOutside,
  findDivergences,
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
 * 关键场景：同一个 id 有多处、且彼此内容都不同。
 *
 * 实测 find-skills 在 shopkeep2/visulima/xianyu-spy 三处加本体库
 * 共四个版本互不相同。收敛为一份时，处理完第一处本体库就变了，
 * 后续几处必须对照新内容重算，不能用启动时的快照。
 */
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
