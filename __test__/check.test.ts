import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  ensureDir,
  isAccessible,
  readJson,
  remove,
  writeFile,
  writeJson,
} from "@visulima/fs";
import { join } from "@visulima/path";
import simpleGit from "simple-git";
import { checkSkill, isCheckError } from "../src/core/check";
import { setAgentsRoot } from "../src/core/paths";
import type { MergeState } from "../src/core/types";
import { updateSkill } from "../src/core/update";

const ROOT = join(import.meta.dir, "..", ".test-tmp", "check");
const AGENTS = join(ROOT, "agents");
const UPSTREAM = join(ROOT, "upstream");

async function seedUpstream(files: Record<string, string>): Promise<void> {
  await remove(UPSTREAM);
  for (const [relative, content] of Object.entries(files)) {
    const full = join(UPSTREAM, relative);
    await ensureDir(join(full, ".."));
    await writeFile(full, content);
  }
  const git = simpleGit(UPSTREAM);
  await git.init();
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  await git.add(".");
  await git.commit("init");
}

async function commitUpstream(files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const full = join(UPSTREAM, relative);
    await ensureDir(join(full, ".."));
    await writeFile(full, content);
  }
  const git = simpleGit(UPSTREAM);
  await git.add(".");
  await git.commit("update");
}

async function seedAgents(
  id: string,
  content: Record<string, string>
): Promise<void> {
  for (const [relative, text] of Object.entries(content)) {
    const full = join(AGENTS, "skills", id, relative);
    await ensureDir(join(full, ".."));
    await writeFile(full, text);
  }
  await writeJson(
    join(AGENTS, ".skill-lock.json"),
    {
      skills: {
        [id]: {
          installedAt: "2026-01-01T00:00:00Z",
          skillFolderHash: "seed",
          skillPath: `skills/${id}/SKILL.md`,
          source: "local/repo",
          sourceType: "github",
          sourceUrl: UPSTREAM,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      },
      version: 3,
    },
    { indent: 2 }
  );
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

/**
 * check 存在的理由：「上游有没有新版本」本地无从推导 ——
 * lockFolderHash 是 skills.sh 安装时算的，不随上游变化。
 * 必须联网拉一次对比，结论落盘供 ls 显示。
 */
describe("checkSkill 只看不动", () => {
  it("上游有新版本时报 upstreamChanged", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" });
    await updateSkill("foo");

    await commitUpstream({ "skills/foo/SKILL.md": "v2\n" });
    const result = await checkSkill("foo");

    if (isCheckError(result)) {
      throw new Error("不应出错");
    }
    expect(result.upstreamChanged).toBe(true);
    expect(result.localChanged).toBe(false);
  });

  it("检查不改动本体库 —— 这是与 update 的根本区别", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" });
    await updateSkill("foo");
    await commitUpstream({ "skills/foo/SKILL.md": "v2\n" });

    await checkSkill("foo");

    // 本体库仍是 v1：check 只观测，不取内容
    const { readFile } = await import("@visulima/fs");
    expect(await readFile(join(AGENTS, "skills", "foo", "SKILL.md"))).toBe(
      "v1\n"
    );
  });

  it("本地改过而上游没动时报 localChanged", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" });
    await updateSkill("foo");

    await writeFile(join(AGENTS, "skills", "foo", "SKILL.md"), "我改的\n");
    const result = await checkSkill("foo");

    if (isCheckError(result)) {
      throw new Error("不应出错");
    }
    expect(result.localChanged).toBe(true);
    expect(result.upstreamChanged).toBe(false);
  });

  it("两边都变时都报 true", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" });
    await updateSkill("foo");

    await writeFile(join(AGENTS, "skills", "foo", "SKILL.md"), "我改的\n");
    await commitUpstream({ "skills/foo/SKILL.md": "v2\n" });
    const result = await checkSkill("foo");

    if (isCheckError(result)) {
      throw new Error("不应出错");
    }
    expect(result.localChanged).toBe(true);
    expect(result.upstreamChanged).toBe(true);
  });

  it("结论写入 state 供 ls 读取", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" });
    await updateSkill("foo");
    await commitUpstream({ "skills/foo/SKILL.md": "v2\n" });

    await checkSkill("foo");

    const state = await readJson<MergeState>(join(AGENTS, ".merge-state.json"));
    expect(state.skills.foo?.lastCheck?.upstreamChanged).toBe(true);
    expect(state.skills.foo?.lastCheck?.at).toMatch(/^\d{4}-/);
  });

  it("无上游记录时返回 no-upstream", async () => {
    await ensureDir(join(AGENTS, "skills", "local-only"));
    await writeFile(
      join(AGENTS, "skills", "local-only", "SKILL.md"),
      "name: x"
    );
    await writeJson(
      join(AGENTS, ".skill-lock.json"),
      { skills: {}, version: 3 },
      { indent: 2 }
    );

    const result = await checkSkill("local-only");

    expect(isCheckError(result)).toBe(true);
    if (isCheckError(result)) {
      expect(result.kind).toBe("no-upstream");
    }
  });

  it("上游拉不到时报 failed 而非误判", async () => {
    await seedUpstream({ "skills/other/SKILL.md": "别的\n" });
    await seedAgents("gone", { "SKILL.md": "我的\n" });

    const result = await checkSkill("gone");

    expect(isCheckError(result)).toBe(true);
    if (isCheckError(result)) {
      expect(result.kind).toBe("failed");
    }
  });

  it("临时工作区用后即删", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" });

    await checkSkill("foo");

    expect(await isAccessible(join(AGENTS, ".check", "foo"))).toBe(false);
  });

  it("没有基线时不谎报本地改动", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "我早就改过了\n" });

    // 从未 update，故没有 .base 快照
    const result = await checkSkill("foo");

    if (isCheckError(result)) {
      throw new Error("不应出错");
    }
    expect(result.noBaseline).toBe(true);
    // 判不出就不说 —— 拿本体库当参照会把「本地改动」误报为 false
    expect(result.localChanged).toBe(false);
    // 但上游与本体库确实不同，这个信号有用
    expect(result.upstreamChanged).toBe(true);
  });
});
