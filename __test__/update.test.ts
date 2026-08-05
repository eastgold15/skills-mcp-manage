import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  ensureDir,
  isAccessible,
  readFile,
  readJson,
  remove,
  writeFile,
  writeJson,
} from "@visulima/fs";
import { join } from "@visulima/path";
import simpleGit from "simple-git";
import { setAgentsRoot } from "../src/core/paths";
import type { MergeState } from "../src/core/types";
import { isUpdateError, updateSkill } from "../src/core/update";

const ROOT = join(import.meta.dir, "..", ".test-tmp", "update");
const AGENTS = join(ROOT, "agents");
const UPSTREAM = join(ROOT, "upstream");

/** 造一个真实的本地 git 仓库当上游，含 monorepo 结构 */
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

/** 追加一次上游提交 */
async function commitUpstream(
  files: Record<string, string>,
  message = "update"
): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const full = join(UPSTREAM, relative);
    await ensureDir(join(full, ".."));
    await writeFile(full, content);
  }
  const git = simpleGit(UPSTREAM);
  await git.add(".");
  await git.commit(message);
}

/** 造本体库与 lock */
async function seedAgents(
  id: string,
  content: Record<string, string>,
  skillPath: string
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
          skillPath,
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

async function readSkill(id: string, relative: string): Promise<string> {
  return (await readFile(join(AGENTS, "skills", id, relative))) as string;
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

describe("updateSkill 端到端更新", () => {
  it("首次更新会建立 base 基线并提示", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" }, "skills/foo/SKILL.md");

    const result = await updateSkill("foo");

    expect(isUpdateError(result)).toBe(false);
    if (isUpdateError(result)) {
      return;
    }
    expect(result.baseInitialized).toBe(true);
    expect(await isAccessible(join(AGENTS, ".base", "foo", "SKILL.md"))).toBe(
      true
    );
  });

  it("象限1：两边都没变，判为无需更新", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" }, "skills/foo/SKILL.md");

    await updateSkill("foo");
    const second = await updateSkill("foo");

    if (isUpdateError(second)) {
      throw new Error("不应出错");
    }
    expect(second.quadrant).toBe(1);
  });

  it("象限2：只有上游变，内容被快进更新", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" }, "skills/foo/SKILL.md");
    await updateSkill("foo");

    await commitUpstream({ "skills/foo/SKILL.md": "v2\n" });
    const result = await updateSkill("foo");

    if (isUpdateError(result)) {
      throw new Error("不应出错");
    }
    expect(result.quadrant).toBe(2);
    expect(await readSkill("foo", "SKILL.md")).toBe("v2\n");
  });

  it("象限3：只有本地变，上游没动则保留本地", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" }, "skills/foo/SKILL.md");
    await updateSkill("foo");

    await writeFile(join(AGENTS, "skills", "foo", "SKILL.md"), "我改的\n");
    const result = await updateSkill("foo");

    if (isUpdateError(result)) {
      throw new Error("不应出错");
    }
    expect(result.quadrant).toBe(3);
    expect(result.conflicts).toEqual([]);
    // 本地修改必须保住
    expect(await readSkill("foo", "SKILL.md")).toBe("我改的\n");
  });

  it("象限4：两边改不同文件时自动融合，双方改动都保住", async () => {
    await seedUpstream({
      "skills/foo/refs/a.md": "a1\n",
      "skills/foo/SKILL.md": "v1\n",
    });
    await seedAgents(
      "foo",
      { "refs/a.md": "a1\n", "SKILL.md": "v1\n" },
      "skills/foo/SKILL.md"
    );
    await updateSkill("foo");

    // 我改 refs/a.md
    await writeFile(join(AGENTS, "skills", "foo", "refs", "a.md"), "我的a\n");
    // 上游改 SKILL.md
    await commitUpstream({ "skills/foo/SKILL.md": "v2\n" });

    const result = await updateSkill("foo");

    if (isUpdateError(result)) {
      throw new Error("不应出错");
    }
    expect(result.quadrant).toBe(4);
    expect(result.conflicts).toEqual([]);
    expect(await readSkill("foo", "SKILL.md")).toBe("v2\n");
    expect(await readSkill("foo", "refs/a.md")).toBe("我的a\n");
  });

  it("象限4：同一文件改同一处时留下冲突标记", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "原始\n尾行\n" });
    await seedAgents(
      "foo",
      { "SKILL.md": "原始\n尾行\n" },
      "skills/foo/SKILL.md"
    );
    await updateSkill("foo");

    await writeFile(
      join(AGENTS, "skills", "foo", "SKILL.md"),
      "我的版本\n尾行\n"
    );
    await commitUpstream({ "skills/foo/SKILL.md": "上游版本\n尾行\n" });

    const result = await updateSkill("foo");

    if (isUpdateError(result)) {
      throw new Error("不应出错");
    }
    expect(result.quadrant).toBe(4);
    expect(result.conflicts).toEqual(["SKILL.md"]);
    const merged = await readSkill("foo", "SKILL.md");
    expect(merged).toContain("<<<<<<<");
    expect(merged).toContain("我的版本");
    expect(merged).toContain("上游版本");
  });

  it("象限4：同一文件改不同段落时能自动三路合并", async () => {
    const original = "一\n二\n三\n四\n五\n六\n七\n八\n";
    await seedUpstream({ "skills/foo/SKILL.md": original });
    await seedAgents("foo", { "SKILL.md": original }, "skills/foo/SKILL.md");
    await updateSkill("foo");

    await writeFile(
      join(AGENTS, "skills", "foo", "SKILL.md"),
      "我改的一\n二\n三\n四\n五\n六\n七\n八\n"
    );
    await commitUpstream({
      "skills/foo/SKILL.md": "一\n二\n三\n四\n五\n六\n七\n上游改的八\n",
    });

    const result = await updateSkill("foo");

    if (isUpdateError(result)) {
      throw new Error("不应出错");
    }
    expect(result.conflicts).toEqual([]);
    const merged = await readSkill("foo", "SKILL.md");
    expect(merged).toContain("我改的一");
    expect(merged).toContain("上游改的八");
  });

  it("上游新增文件会被取来，本地新增文件不被抹掉", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" }, "skills/foo/SKILL.md");
    await updateSkill("foo");

    await writeFile(join(AGENTS, "skills", "foo", "mine.md"), "我的私货\n");
    await commitUpstream({ "skills/foo/refs/new.md": "上游新增\n" });

    const result = await updateSkill("foo");

    if (isUpdateError(result)) {
      throw new Error("不应出错");
    }
    expect(await readSkill("foo", "refs/new.md")).toBe("上游新增\n");
    expect(await readSkill("foo", "mine.md")).toBe("我的私货\n");
  });

  it("无上游记录的 skill 返回 no-upstream", async () => {
    await ensureDir(join(AGENTS, "skills", "local-only"));
    await writeFile(
      join(AGENTS, "skills", "local-only", "SKILL.md"),
      "name: local-only"
    );
    await writeJson(
      join(AGENTS, ".skill-lock.json"),
      { skills: {}, version: 3 },
      { indent: 2 }
    );

    const result = await updateSkill("local-only");

    expect(isUpdateError(result)).toBe(true);
    if (!isUpdateError(result)) {
      return;
    }
    expect(result.kind).toBe("no-upstream");
  });

  it("本体库里没有的 skill 返回 unknown", async () => {
    await writeJson(
      join(AGENTS, ".skill-lock.json"),
      { skills: {}, version: 3 },
      { indent: 2 }
    );

    const result = await updateSkill("ghost");

    expect(isUpdateError(result)).toBe(true);
    if (!isUpdateError(result)) {
      return;
    }
    expect(result.kind).toBe("unknown");
  });

  it("更新后把 commit 记入 state 作为辅助锚点", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" }, "skills/foo/SKILL.md");

    await updateSkill("foo");

    const raw = await readJson<MergeState>(join(AGENTS, ".merge-state.json"));
    expect(raw.skills.foo!.base!.upstreamCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("临时工作区在更新后被清理", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "v1\n" });
    await seedAgents("foo", { "SKILL.md": "v1\n" }, "skills/foo/SKILL.md");

    await updateSkill("foo");

    expect(await isAccessible(join(AGENTS, ".work", "foo"))).toBe(false);
  });

  it("有冲突时不推进 base，以便下次仍能识别", async () => {
    await seedUpstream({ "skills/foo/SKILL.md": "原始\n" });
    await seedAgents("foo", { "SKILL.md": "原始\n" }, "skills/foo/SKILL.md");
    await updateSkill("foo");

    await writeFile(join(AGENTS, "skills", "foo", "SKILL.md"), "我的\n");
    await commitUpstream({ "skills/foo/SKILL.md": "上游\n" });
    await updateSkill("foo");

    // base 仍是最初的内容，未被推进
    expect(
      (await readFile(join(AGENTS, ".base", "foo", "SKILL.md"))) as string
    ).toBe("原始\n");
  });
});
