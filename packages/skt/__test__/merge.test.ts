import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  ensureDir,
  isAccessible,
  readFile,
  remove,
  writeFile,
} from "@visulima/fs";
import { join } from "@visulima/path";
import { decideFiles, mapDirectory } from "../src/core/diff";
import { skillPathToDir } from "../src/core/fetch";
import { buildPlan, mergeDirectories, snapshotBase } from "../src/core/merge";

const ROOT = join(import.meta.dir, "..", ".test-tmp", "merge");

async function seedDir(
  name: string,
  files: Record<string, string>
): Promise<string> {
  const dir = join(ROOT, name);
  await remove(dir);
  for (const [relative, content] of Object.entries(files)) {
    const full = join(dir, relative);
    await ensureDir(join(full, ".."));
    await writeFile(full, content);
  }
  await ensureDir(dir);
  return dir;
}

async function read(dir: string, relative: string): Promise<string> {
  return (await readFile(join(dir, relative))) as string;
}

beforeEach(async () => {
  await remove(ROOT);
  await ensureDir(ROOT);
});

afterAll(async () => {
  await remove(ROOT);
});

describe("skillPathToDir 从 skillPath 取目录", () => {
  it("去掉末尾的 SKILL.md", () => {
    expect(skillPathToDir("skills/foo/SKILL.md")).toBe("skills/foo");
  });

  it("处理多层嵌套", () => {
    expect(skillPathToDir("ast-grep/skills/ast-grep/SKILL.md")).toBe(
      "ast-grep/skills/ast-grep"
    );
  });

  it("反斜杠路径也能处理", () => {
    expect(skillPathToDir("skills\\foo\\SKILL.md")).toBe("skills/foo");
  });
});

describe("buildPlan 合并计划", () => {
  it("把各类判定归入对应动作", () => {
    const verdicts = decideFiles(
      new Map([
        ["take", "b"],
        ["keep", "b"],
        ["gone", "b"],
        ["clash", "b"],
      ]),
      new Map([
        ["take", "b"],
        ["keep", "mine"],
        ["gone", "b"],
        ["clash", "mine"],
      ]),
      new Map([
        ["take", "theirs"],
        ["keep", "b"],
        ["clash", "theirs"],
        ["fresh", "new"],
      ])
    );

    const plan = buildPlan(verdicts);

    expect(plan.takeTheirs.sort((a, b) => a.localeCompare(b))).toEqual([
      "fresh",
      "take",
    ]);
    expect(plan.keepOurs).toEqual(["keep"]);
    expect(plan.deletions).toEqual(["gone"]);
    expect(plan.merges).toEqual(["clash"]);
  });
});

describe("mergeDirectories 端到端合并", () => {
  it("改动不同文件时自动合并，两边改动都保住", async () => {
    const base = await seedDir("base1", {
      "ref.md": "参考原文\n",
      "SKILL.md": "原始\n",
    });
    const ours = await seedDir("ours1", {
      "ref.md": "我的参考\n",
      "SKILL.md": "原始\n",
    });
    const theirs = await seedDir("theirs1", {
      "ref.md": "参考原文\n",
      "SKILL.md": "上游新版\n",
    });

    const result = await mergeDirectories(
      {
        base: await mapDirectory(base),
        ours: await mapDirectory(ours),
        theirs: await mapDirectory(theirs),
      },
      { base, ours, theirs }
    );

    expect(result.conflicted).toEqual([]);
    expect(await read(ours, "SKILL.md")).toBe("上游新版\n");
    expect(await read(ours, "ref.md")).toBe("我的参考\n");
  });

  it("上游新增的文件会被取来", async () => {
    const base = await seedDir("base2", { "a.md": "1\n" });
    const ours = await seedDir("ours2", { "a.md": "1\n" });
    const theirs = await seedDir("theirs2", {
      "a.md": "1\n",
      "new.md": "新文件\n",
    });

    await mergeDirectories(
      {
        base: await mapDirectory(base),
        ours: await mapDirectory(ours),
        theirs: await mapDirectory(theirs),
      },
      { base, ours, theirs }
    );

    expect(await read(ours, "new.md")).toBe("新文件\n");
  });

  it("本地新增的文件不会被上游抹掉", async () => {
    const base = await seedDir("base3", { "a.md": "1\n" });
    const ours = await seedDir("ours3", {
      "a.md": "1\n",
      "mine.md": "我的私货\n",
    });
    const theirs = await seedDir("theirs3", { "a.md": "1\n" });

    await mergeDirectories(
      {
        base: await mapDirectory(base),
        ours: await mapDirectory(ours),
        theirs: await mapDirectory(theirs),
      },
      { base, ours, theirs }
    );

    expect(await read(ours, "mine.md")).toBe("我的私货\n");
  });

  it("上游删除且本地没改，文件被删掉", async () => {
    const base = await seedDir("base4", { "a.md": "1\n", "old.md": "旧\n" });
    const ours = await seedDir("ours4", { "a.md": "1\n", "old.md": "旧\n" });
    const theirs = await seedDir("theirs4", { "a.md": "1\n" });

    await mergeDirectories(
      {
        base: await mapDirectory(base),
        ours: await mapDirectory(ours),
        theirs: await mapDirectory(theirs),
      },
      { base, ours, theirs }
    );

    expect(await isAccessible(join(ours, "old.md"))).toBe(false);
  });

  it("上游删除但本地改过，保留本地并报冲突", async () => {
    const base = await seedDir("base5", { "old.md": "旧\n" });
    const ours = await seedDir("ours5", { "old.md": "我改过\n" });
    const theirs = await seedDir("theirs5", {});

    const result = await mergeDirectories(
      {
        base: await mapDirectory(base),
        ours: await mapDirectory(ours),
        theirs: await mapDirectory(theirs),
      },
      { base, ours, theirs }
    );

    expect(result.conflicted).toContain("old.md");
    expect(await read(ours, "old.md")).toBe("我改过\n");
  });

  it("同一文件改不同段落时能自动三路合并", async () => {
    const baseText = "第一行\n第二行\n第三行\n第四行\n第五行\n";
    const base = await seedDir("base6", { "SKILL.md": baseText });
    // 我们改开头
    const ours = await seedDir("ours6", {
      "SKILL.md": "我改的第一行\n第二行\n第三行\n第四行\n第五行\n",
    });
    // 上游改结尾
    const theirs = await seedDir("theirs6", {
      "SKILL.md": "第一行\n第二行\n第三行\n第四行\n上游改的第五行\n",
    });

    const result = await mergeDirectories(
      {
        base: await mapDirectory(base),
        ours: await mapDirectory(ours),
        theirs: await mapDirectory(theirs),
      },
      { base, ours, theirs }
    );

    const merged = await read(ours, "SKILL.md");
    expect(result.conflicted).toEqual([]);
    expect(merged).toContain("我改的第一行");
    expect(merged).toContain("上游改的第五行");
  });

  it("同一文件改同一行时留下冲突标记", async () => {
    const base = await seedDir("base7", { "SKILL.md": "原始行\n其他\n" });
    const ours = await seedDir("ours7", { "SKILL.md": "我的版本\n其他\n" });
    const theirs = await seedDir("theirs7", { "SKILL.md": "上游版本\n其他\n" });

    const result = await mergeDirectories(
      {
        base: await mapDirectory(base),
        ours: await mapDirectory(ours),
        theirs: await mapDirectory(theirs),
      },
      { base, ours, theirs }
    );

    expect(result.conflicted).toEqual(["SKILL.md"]);
    const merged = await read(ours, "SKILL.md");
    expect(merged).toContain("<<<<<<<");
    expect(merged).toContain("我的版本");
    expect(merged).toContain("上游版本");
  });

  it("嵌套目录里的文件同样参与合并", async () => {
    const base = await seedDir("base8", { "refs/deep/a.md": "原\n" });
    const ours = await seedDir("ours8", { "refs/deep/a.md": "原\n" });
    const theirs = await seedDir("theirs8", { "refs/deep/a.md": "上游改\n" });

    await mergeDirectories(
      {
        base: await mapDirectory(base),
        ours: await mapDirectory(ours),
        theirs: await mapDirectory(theirs),
      },
      { base, ours, theirs }
    );

    expect(await read(ours, "refs/deep/a.md")).toBe("上游改\n");
  });
});

describe("snapshotBase base 快照", () => {
  it("把内容目录原样复制为快照", async () => {
    const content = await seedDir("content", {
      "refs/a.md": "a\n",
      "SKILL.md": "v1\n",
    });
    const target = join(ROOT, "basesnap");

    await snapshotBase(content, target);

    expect(await read(target, "SKILL.md")).toBe("v1\n");
    expect(await read(target, "refs/a.md")).toBe("a\n");
  });

  it("重复快照会覆盖旧内容而非累积", async () => {
    const target = join(ROOT, "basesnap2");
    const first = await seedDir("c1", { "old.md": "旧\n" });
    await snapshotBase(first, target);

    const second = await seedDir("c2", { "new.md": "新\n" });
    await snapshotBase(second, target);

    expect(await isAccessible(join(target, "old.md"))).toBe(false);
    expect(await read(target, "new.md")).toBe("新\n");
  });
});

describe("mapDirectory 目录清单", () => {
  it("相对路径用正斜杠，跨平台一致", async () => {
    const dir = await seedDir("mapd", { "refs/deep/a.md": "x" });

    const map = await mapDirectory(dir);

    expect([...map.keys()]).toEqual(["refs/deep/a.md"]);
  });

  it("目录不存在时返回空清单", async () => {
    const map = await mapDirectory(join(ROOT, "不存在"));

    expect(map.size).toBe(0);
  });

  it("内容相同的文件哈希一致", async () => {
    const dir = await seedDir("mapd2", {
      "a.md": "同样内容",
      "b.md": "同样内容",
    });

    const map = await mapDirectory(dir);

    expect(map.get("a.md")).toBe(map.get("b.md"));
  });
});
