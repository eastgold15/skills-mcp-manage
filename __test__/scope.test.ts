import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { symlink } from "node:fs/promises";
import { ensureDir, isAccessible, remove, writeFile } from "@visulima/fs";
import { join } from "@visulima/path";
import { setAgentsRoot, setGlobalRoot } from "../src/core/paths";
import {
  disableSkill,
  enableSkill,
  managedIds,
  scanScope,
} from "../src/core/scope";

const ROOT = join(import.meta.dir, "..", ".test-tmp", "scope");
const AGENTS = join(ROOT, "agents");
const HOME = join(ROOT, "home");
const PROJECT = join(ROOT, "project");
/** 模拟别的工具的本体库（如 ~/.skills-manager） */
const FOREIGN = join(ROOT, "foreign");

async function seed(libraryIds: string[]) {
  await remove(ROOT);
  for (const id of libraryIds) {
    const dir = join(AGENTS, "skills", id);
    await ensureDir(dir);
    await writeFile(join(dir, "SKILL.md"), `name: ${id}`);
  }
  await ensureDir(HOME);
  await ensureDir(PROJECT);
}

beforeEach(() => {
  setAgentsRoot(AGENTS);
  setGlobalRoot(HOME);
});

afterAll(async () => {
  setAgentsRoot(undefined);
  setGlobalRoot(undefined);
  await remove(ROOT);
});

describe("enableSkill 启用到作用域", () => {
  it("在项目作用域建立指向本体库的链接", async () => {
    await seed(["foo"]);

    expect(await enableSkill("project", PROJECT, "foo")).toBe("enabled");
    expect(
      await isAccessible(join(PROJECT, ".claude", "skills", "foo", "SKILL.md"))
    ).toBe(true);
  });

  it("在全局作用域建立链接", async () => {
    await seed(["foo"]);

    expect(await enableSkill("global", PROJECT, "foo")).toBe("enabled");
    expect(
      await isAccessible(join(HOME, ".claude", "skills", "foo", "SKILL.md"))
    ).toBe(true);
  });

  it("同一 skill 可同时启用到全局与项目", async () => {
    await seed(["foo"]);

    await enableSkill("global", PROJECT, "foo");
    await enableSkill("project", PROJECT, "foo");

    expect(await managedIds("global", PROJECT)).toEqual(new Set(["foo"]));
    expect(await managedIds("project", PROJECT)).toEqual(new Set(["foo"]));
  });

  it("重复启用返回 already-enabled 而非报错", async () => {
    await seed(["foo"]);

    await enableSkill("project", PROJECT, "foo");
    expect(await enableSkill("project", PROJECT, "foo")).toBe(
      "already-enabled"
    );
  });

  it("本体库里没有的 skill 返回 missing", async () => {
    await seed([]);

    expect(await enableSkill("project", PROJECT, "ghost")).toBe("missing");
  });

  it("目标位置被真实目录占用时不覆盖", async () => {
    await seed(["foo"]);
    const occupied = join(PROJECT, ".claude", "skills", "foo");
    await ensureDir(occupied);
    await writeFile(join(occupied, "SKILL.md"), "手写的，不能被覆盖");

    expect(await enableSkill("project", PROJECT, "foo")).toBe("occupied");
  });
});

describe("scanScope 识别条目形态", () => {
  it("指向本体库的链接识别为 managed", async () => {
    await seed(["foo"]);
    await enableSkill("project", PROJECT, "foo");

    const entries = await scanScope("project", PROJECT);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("managed");
  });

  it("指向别处的链接识别为 external", async () => {
    await seed(["foo"]);
    const foreignSkill = join(FOREIGN, "skills", "bar");
    await ensureDir(foreignSkill);
    const dir = join(PROJECT, ".claude", "skills");
    await ensureDir(dir);
    await symlink(foreignSkill, join(dir, "bar"), "junction");

    const entries = await scanScope("project", PROJECT);

    expect(entries[0]?.kind).toBe("external");
  });

  it("真实目录识别为 directory", async () => {
    await seed([]);
    const dir = join(PROJECT, ".claude", "skills", "copied");
    await ensureDir(dir);
    await writeFile(join(dir, "SKILL.md"), "name: copied");

    const entries = await scanScope("project", PROJECT);

    expect(entries[0]?.kind).toBe("directory");
  });

  it("作用域目录不存在时返回空数组", async () => {
    await seed([]);

    expect(await scanScope("project", PROJECT)).toEqual([]);
  });

  it("managedIds 只收 managed，忽略 external 与 directory", async () => {
    await seed(["mine"]);
    await enableSkill("project", PROJECT, "mine");

    const dir = join(PROJECT, ".claude", "skills");
    const foreignSkill = join(FOREIGN, "skills", "theirs");
    await ensureDir(foreignSkill);
    await symlink(foreignSkill, join(dir, "theirs"), "junction");
    await ensureDir(join(dir, "copied"));

    expect(await managedIds("project", PROJECT)).toEqual(new Set(["mine"]));
  });
});

describe("disableSkill 从作用域卸载", () => {
  it("删除我们建的链接，本体库不受影响", async () => {
    await seed(["foo"]);
    await enableSkill("project", PROJECT, "foo");

    expect(await disableSkill("project", PROJECT, "foo")).toBe("disabled");
    expect(await isAccessible(join(PROJECT, ".claude", "skills", "foo"))).toBe(
      false
    );
    // 本体必须还在
    expect(await isAccessible(join(AGENTS, "skills", "foo", "SKILL.md"))).toBe(
      true
    );
  });

  it("未启用时返回 not-enabled", async () => {
    await seed(["foo"]);

    expect(await disableSkill("project", PROJECT, "foo")).toBe("not-enabled");
  });

  it("拒绝删除外部工具建的链接", async () => {
    await seed([]);
    const foreignSkill = join(FOREIGN, "skills", "theirs");
    await ensureDir(foreignSkill);
    const dir = join(PROJECT, ".claude", "skills");
    await ensureDir(dir);
    await symlink(foreignSkill, join(dir, "theirs"), "junction");

    expect(await disableSkill("project", PROJECT, "theirs")).toBe(
      "not-managed"
    );
    expect(await isAccessible(join(dir, "theirs"))).toBe(true);
  });

  it("拒绝删除真实目录（可能是手写的）", async () => {
    await seed([]);
    const dir = join(PROJECT, ".claude", "skills", "handwritten");
    await ensureDir(dir);
    await writeFile(join(dir, "SKILL.md"), "珍贵内容");

    expect(await disableSkill("project", PROJECT, "handwritten")).toBe(
      "not-managed"
    );
    expect(await isAccessible(join(dir, "SKILL.md"))).toBe(true);
  });

  it("全局与项目互不干扰：卸载项目的不影响全局", async () => {
    await seed(["foo"]);
    await enableSkill("global", PROJECT, "foo");
    await enableSkill("project", PROJECT, "foo");

    await disableSkill("project", PROJECT, "foo");

    expect(await managedIds("project", PROJECT)).toEqual(new Set());
    expect(await managedIds("global", PROJECT)).toEqual(new Set(["foo"]));
  });
});
