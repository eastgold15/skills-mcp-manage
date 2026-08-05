import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { lstat } from "node:fs/promises";
import {
  ensureDir,
  isAccessible,
  readFile,
  remove,
  writeFile,
  writeJson,
} from "@visulima/fs";
import { join } from "@visulima/path";
import { compilePolicy, configFile, defaultConfig } from "../src/core/config";
import { normalizeOne } from "../src/core/normalize";
import { libraryDir, setAgentsRoot } from "../src/core/paths";
import { bystanders, conflicts, outsiders, scanRoots } from "../src/core/scan";
import type { ScanConfig, ScanHit } from "../src/core/types";

const ROOT = join(import.meta.dir, "..", ".test-tmp", "scan");
const AGENTS = join(ROOT, "agents");
const DISK = join(ROOT, "disk");

/** 在指定位置造一个 skill（含 SKILL.md） */
async function makeSkill(path: string, content = "内容\n"): Promise<void> {
  await ensureDir(path);
  await writeFile(join(path, "SKILL.md"), content);
}

/** 造一份策略配置 */
async function seedConfig(partial: Partial<ScanConfig> = {}): Promise<void> {
  await ensureDir(AGENTS);
  await writeJson(
    configFile(),
    { ...defaultConfig(), ...partial },
    { indent: 2 }
  );
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

describe("扫描策略由配置决定", () => {
  it("include 命中的算作可归一化", () => {
    const policy = compilePolicy({
      exclude: [],
      include: ["**/.claude/skills/*"],
      roots: [],
      version: 1,
    });

    expect(policy.included("L:/proj/.claude/skills/foo")).toBe(true);
    expect(policy.included("L:/proj/other/foo")).toBe(false);
  });

  it("exclude 优先级高于 include", () => {
    const policy = compilePolicy({
      exclude: ["**/builtin/**"],
      include: ["**/.claude/skills/*"],
      roots: [],
      version: 1,
    });

    const path = "C:/app/builtin/.claude/skills/foo";
    expect(policy.included(path)).toBe(true);
    expect(policy.excluded(path)).toBe(true);
  });

  it("默认配置挡掉实测确认的第三方内置位置", () => {
    const policy = compilePolicy(defaultConfig());

    // 这些是真实机器上扫到的第三方资源，共 1900+ 处
    const thirdParty = [
      "C:/Users/boer/.trae-cn/builtin/work/iris/skills/xlsx",
      "C:/Users/boer/AppData/Local/hermes/skills/social-media/xurl",
      "C:/Users/boer/AppData/Local/Hermes Agent CN Desktop/bundled-skills/yuanbao",
      "C:/Users/boer/.bun/install/cache/openclaw@1/skills/xurl",
      "C:/Users/boer/.claude/plugins/cache/x/skills/foo",
    ];
    for (const path of thirdParty) {
      expect(policy.excluded(path)).toBe(true);
    }
  });

  it("默认配置认可公认的 skill 安装位置", () => {
    const policy = compilePolicy(defaultConfig());

    const mine = [
      "L:/proj/.claude/skills/codegraph",
      "C:/Users/boer/.claude/skills/codegraph",
      "L:/proj/.agents/skills/codegraph",
      "C:/Users/boer/.codeg/skills/writing-plans",
    ];
    for (const path of mine) {
      expect(policy.included(path)).toBe(true);
      expect(policy.excluded(path)).toBe(false);
    }
  });
});

/**
 * 测试用的策略：默认 exclude 里有 `**\/.test-tmp/**`（防止扫到测试残留），
 * 而测试夹具正建在 .test-tmp 下，会被自己挡掉。这里只保留 include。
 */
function testPolicy(extraExclude: string[] = []) {
  return compilePolicy({
    exclude: extraExclude,
    include: defaultConfig().include,
    roots: [],
    version: 1,
  });
}

describe("scanRoots 找出磁盘上的 skill", () => {
  it("按 SKILL.md 判定，认出各处的 skill", async () => {
    await makeSkill(join(DISK, "proj", ".claude", "skills", "alpha"));
    await makeSkill(join(DISK, "proj", ".claude", "skills", "beta"));
    // 没有 SKILL.md 的目录不算
    await ensureDir(join(DISK, "proj", ".claude", "skills", "empty"));

    const hits = await scanRoots([DISK], testPolicy());

    expect(hits.map((h) => h.id).sort()).toEqual(["alpha", "beta"]);
  });

  it("被 exclude 挡掉的仍会扫到，但标为不可归一化", async () => {
    await makeSkill(
      join(DISK, "vendor", "builtin", ".claude", "skills", "builtin-one")
    );
    await makeSkill(join(DISK, "proj", ".claude", "skills", "mine"));

    const hits = await scanRoots([DISK], testPolicy(["**/builtin/**"]));

    // 两个都扫到了 —— 这很重要，用户要能看见被挡掉的是什么
    expect(hits).toHaveLength(2);
    expect(outsiders(hits).map((h) => h.id)).toEqual(["mine"]);
    expect(bystanders(hits).map((h) => h.id)).toEqual(["builtin-one"]);
  });

  it("不存在的根目录不报错，返回空", async () => {
    const hits = await scanRoots([join(ROOT, "nope")], testPolicy());
    expect(hits).toEqual([]);
  });

  it("识别出同名多处的冲突", async () => {
    await makeSkill(join(DISK, "a", ".claude", "skills", "dup"), "甲\n");
    await makeSkill(join(DISK, "b", ".claude", "skills", "dup"), "乙\n");
    await makeSkill(join(DISK, "c", ".claude", "skills", "solo"));

    const hits = await scanRoots([DISK], testPolicy());
    const dup = conflicts(hits);

    expect([...dup.keys()]).toEqual(["dup"]);
    expect(dup.get("dup")).toHaveLength(2);
  });
});

/**
 * 归一化会移动用户文件，这组测试是安全网。
 *
 * 实测这台机器上 201 个待归一化位置里，52 个 id 在 117 处重复 ——
 * 同名不等于同内容，静默覆盖会真丢数据。
 */
describe("归一化绝不静默覆盖", () => {
  it("本体库已有同名但内容不同时，一个文件都不动", async () => {
    await makeSkill(join(libraryDir(), "dup"), "本体库版本\n");
    const outside = join(DISK, "proj", ".claude", "skills", "dup");
    await makeSkill(outside, "我改过的不同版本\n");

    const result = await normalizeOne(hitFor(outside, "dup"));

    expect(result.outcome).toBe("diverged");
    // 三重确认：原文件、原形态、本体库内容都未变
    expect(await readFile(join(outside, "SKILL.md"))).toBe(
      "我改过的不同版本\n"
    );
    expect((await lstat(outside)).isSymbolicLink()).toBe(false);
    expect(await readFile(join(libraryDir(), "dup", "SKILL.md"))).toBe(
      "本体库版本\n"
    );
  });

  it("内容一致时换成链接，本体库不动", async () => {
    await makeSkill(join(libraryDir(), "same"), "一样的\n");
    const outside = join(DISK, "proj", ".claude", "skills", "same");
    await makeSkill(outside, "一样的\n");

    const result = await normalizeOne(hitFor(outside, "same"));

    expect(result.outcome).toBe("linked");
    expect((await lstat(outside)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(outside, "SKILL.md"))).toBe("一样的\n");
  });

  it("本体库没有时收编，原位置换成链接", async () => {
    const outside = join(DISK, "proj", ".claude", "skills", "fresh");
    await makeSkill(outside, "全新的\n");

    const result = await normalizeOne(hitFor(outside, "fresh"));

    expect(result.outcome).toBe("adopted");
    expect(await isAccessible(join(libraryDir(), "fresh", "SKILL.md"))).toBe(
      true
    );
    expect((await lstat(outside)).isSymbolicLink()).toBe(true);
    // 通过链接仍能读到内容
    expect(await readFile(join(outside, "SKILL.md"))).toBe("全新的\n");
  });

  it("已指向本体库的链接识别为无需处理", async () => {
    await makeSkill(join(libraryDir(), "linked"), "内容\n");
    const outside = join(DISK, "proj", ".claude", "skills", "linked");

    const result = await normalizeOne({
      adoptable: true,
      id: "linked",
      inLibrary: false,
      isLink: true,
      path: outside,
      target: join(libraryDir(), "linked"),
    });

    expect(result.outcome).toBe("already");
  });

  it("指向别处的链接不碰（可能是别的工具建的）", async () => {
    const outside = join(DISK, "proj", ".claude", "skills", "foreign");

    const result = await normalizeOne({
      adoptable: true,
      id: "foreign",
      inLibrary: false,
      isLink: true,
      path: outside,
      target: "C:/Users/boer/.skills-manager/skills/foreign",
    });

    expect(result.outcome).toBe("external");
  });
});

describe("配置读写", () => {
  it("首次读取会写入默认配置", async () => {
    const { ensureConfig } = await import("../src/core/config");
    const config = await ensureConfig();

    expect(config.include.length).toBeGreaterThan(0);
    expect(await isAccessible(configFile())).toBe(true);
  });

  it("已有配置不被覆盖", async () => {
    await seedConfig({ include: ["**/my-skills/*"], roots: ["D:/only-here"] });
    const { ensureConfig } = await import("../src/core/config");
    const config = await ensureConfig();

    expect(config.include).toEqual(["**/my-skills/*"]);
    expect(config.roots).toEqual(["D:/only-here"]);
  });
});
