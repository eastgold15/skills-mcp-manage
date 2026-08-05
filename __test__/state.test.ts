import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { ensureDir, remove, writeFile, writeJson } from "@visulima/fs";
import { join } from "@visulima/path";
import { setAgentsRoot } from "../src/core/paths";
import { syncFromLock, writeState } from "../src/core/state";
import type { MergeState } from "../src/core/types";

const ROOT = join(import.meta.dir, "..", ".test-tmp", "state");

/** 造一个假的 ~/.agents：lock + 本体库目录 */
async function seedAgents(options: {
  lock?: Record<string, unknown>;
  /** 本体库里存在的目录（会建 SKILL.md） */
  library?: string[];
}) {
  await remove(ROOT);
  await ensureDir(ROOT);

  for (const id of options.library ?? []) {
    const dir = join(ROOT, "skills", id);
    await ensureDir(dir);
    await writeFile(join(dir, "SKILL.md"), `name: ${id}`);
  }

  if (options.lock) {
    await writeJson(join(ROOT, ".skill-lock.json"), options.lock, {
      indent: 2,
    });
  }
}

function lockEntry(sourceUrl: string, folderHash = "h1") {
  return {
    installedAt: "2026-01-01T00:00:00Z",
    skillFolderHash: folderHash,
    skillPath: "skills/foo/SKILL.md",
    source: "org/repo",
    sourceType: "github",
    sourceUrl,
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  setAgentsRoot(ROOT);
});

afterAll(async () => {
  setAgentsRoot(undefined);
  await remove(ROOT);
});

describe("syncFromLock 单向同步", () => {
  it("把 lock 记录的 skill 投影为可更新条目", async () => {
    await seedAgents({
      library: ["foo"],
      lock: { skills: { foo: lockEntry("https://a.git") }, version: 3 },
    });

    const state = await syncFromLock();

    expect(state.skills.foo?.upstream?.sourceUrl).toBe("https://a.git");
    expect(state.skills.foo?.base).toBeNull();
  });

  it("本体库里存在但 lock 未记录的，纳入为无上游条目", async () => {
    await seedAgents({
      library: ["foo", "untracked"],
      lock: { skills: { foo: lockEntry("https://a.git") }, version: 3 },
    });

    const state = await syncFromLock();

    expect(Object.keys(state.skills).sort()).toEqual(["foo", "untracked"]);
    expect(state.skills.untracked?.upstream).toBeNull();
  });

  it("没有 SKILL.md 的目录不算 skill", async () => {
    await seedAgents({ library: ["real"], lock: { skills: {}, version: 3 } });
    await ensureDir(join(ROOT, "skills", "not-a-skill"));

    const state = await syncFromLock();

    expect(Object.keys(state.skills)).toEqual(["real"]);
  });

  it("lock 缺失时也能只靠本体库工作", async () => {
    await seedAgents({ library: ["solo"] });

    const state = await syncFromLock();

    expect(state.skills.solo?.upstream).toBeNull();
  });

  it("lock 未变时跳过投影，保留我们的 base 与 lastMerge", async () => {
    await seedAgents({
      library: ["foo"],
      lock: { skills: { foo: lockEntry("https://a.git") }, version: 3 },
    });

    const first = await syncFromLock();
    first.skills.foo!.base = { contentHash: "c0", syncedAt: "T0" };
    first.skills.foo!.lastMerge = { at: "T0", conflicts: ["x"], quadrant: 4 };
    await writeState(first);

    const second = await syncFromLock();

    expect(second.skills.foo?.base?.contentHash).toBe("c0");
    expect(second.skills.foo?.lastMerge?.conflicts).toEqual(["x"]);
  });

  it("lock 变动时覆盖 upstream，但不动 base 与 lastMerge", async () => {
    await seedAgents({
      library: ["foo"],
      lock: { skills: { foo: lockEntry("https://old.git", "h1") }, version: 3 },
    });

    const first = await syncFromLock();
    first.skills.foo!.base = { contentHash: "c0", syncedAt: "T0" };
    first.skills.foo!.lastMerge = { at: "T0", conflicts: ["x"], quadrant: 4 };
    await writeState(first);

    // skills.sh 侧改了上游地址
    await writeJson(
      join(ROOT, ".skill-lock.json"),
      { skills: { foo: lockEntry("https://new.git", "h2") }, version: 3 },
      { indent: 2 }
    );

    const second = await syncFromLock();

    expect(second.skills.foo?.upstream?.sourceUrl).toBe("https://new.git");
    expect(second.skills.foo?.upstream?.lockFolderHash).toBe("h2");
    expect(second.skills.foo?.base?.contentHash).toBe("c0");
    expect(second.skills.foo?.lastMerge?.conflicts).toEqual(["x"]);
  });

  it("lock 与本体库都消失的条目标记 orphaned 而不删除", async () => {
    await seedAgents({
      library: ["gone"],
      lock: { skills: { gone: lockEntry("https://a.git") }, version: 3 },
    });

    const first = await syncFromLock();
    first.skills.gone!.base = { contentHash: "keep-me", syncedAt: "T0" };
    await writeState(first);

    // skills.sh 卸载了它：lock 与目录都没了
    await seedAgents({ library: [], lock: { skills: {}, version: 3 } });
    await writeState(first);

    const second = await syncFromLock();

    expect(second.skills.gone?.orphaned).toBe(true);
    expect(second.skills.gone?.base?.contentHash).toBe("keep-me");
  });

  it("记录 lock 的文件哈希用于门控", async () => {
    await seedAgents({
      library: ["foo"],
      lock: { skills: { foo: lockEntry("https://a.git") }, version: 3 },
    });

    const state = await syncFromLock();

    expect(state.lockFileHash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("state 版本不符时重建而非崩溃", async () => {
    await seedAgents({
      library: ["foo"],
      lock: { skills: { foo: lockEntry("https://a.git") }, version: 3 },
    });
    await writeJson(
      join(ROOT, ".merge-state.json"),
      { skills: { stale: {} }, version: 999 } as unknown as MergeState,
      { indent: 2 }
    );

    const state = await syncFromLock();

    expect(state.version).toBe(1);
    expect(state.skills.stale).toBeUndefined();
    expect(state.skills.foo).toBeDefined();
  });
});
