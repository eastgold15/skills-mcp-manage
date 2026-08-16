import { describe, expect, it } from "bun:test";
import type { SkillState } from "../src/core/types";
import { deriveStatus } from "../src/core/view";

/** 造一个 state 条目 */
function skill(partial: Partial<SkillState> = {}): SkillState {
  return {
    base: null,
    upstream: {
      lockFolderHash: "h",
      skillPath: "skills/x/SKILL.md",
      sourceUrl: "https://x.git",
    },
    ...partial,
  };
}

/**
 * 「有上游」与「有新版本」是两件事。
 *
 * 原先 list 把它们合成一列叫「可更新」，用户看到就去跑 update，
 * 结果提示「上游无变化」—— 看起来像工具自相矛盾。
 * tracked 回答能不能 update，status 回答要不要。
 */
describe("deriveStatus 区分能力与必要性", () => {
  it("没有上游就没有同步状态", () => {
    expect(deriveStatus(skill({ upstream: null }))).toBe("no-upstream");
  });

  it("有上游但从未检查过 → unknown", () => {
    expect(deriveStatus(skill())).toBe("unknown");
  });

  it("check 说上游有变、本地没动 → behind", () => {
    const status = deriveStatus(
      skill({
        lastCheck: {
          at: "2026-08-05T10:00:00Z",
          localChanged: false,
          upstreamChanged: true,
        },
      })
    );
    expect(status).toBe("behind");
  });

  it("check 说两边都变 → diverged（update 会三路合并）", () => {
    const status = deriveStatus(
      skill({
        lastCheck: {
          at: "2026-08-05T10:00:00Z",
          localChanged: true,
          upstreamChanged: true,
        },
      })
    );
    expect(status).toBe("diverged");
  });

  it("check 说只有本地改过 → local-only（跑 update 也不会变）", () => {
    const status = deriveStatus(
      skill({
        lastCheck: {
          at: "2026-08-05T10:00:00Z",
          localChanged: true,
          upstreamChanged: false,
        },
      })
    );
    expect(status).toBe("local-only");
  });

  it("check 说两边都没变 → up-to-date", () => {
    const status = deriveStatus(
      skill({
        lastCheck: {
          at: "2026-08-05T10:00:00Z",
          localChanged: false,
          upstreamChanged: false,
        },
      })
    );
    expect(status).toBe("up-to-date");
  });

  it("上次合并留了冲突 → conflicted，优先于其他状态", () => {
    const status = deriveStatus(
      skill({
        lastMerge: {
          at: "2026-08-05T10:00:00Z",
          conflicts: ["SKILL.md"],
          quadrant: 4,
        },
      })
    );
    expect(status).toBe("conflicted");
  });

  it("象限3（只有本地改）→ local-only，这正是用户遇到的情况", () => {
    const status = deriveStatus(
      skill({
        lastMerge: {
          at: "2026-08-05T10:00:00Z",
          conflicts: [],
          quadrant: 3,
        },
      })
    );
    // 实测 find-skills 就是这个状态：update 提示「上游无变化，保留本地修改」
    expect(status).toBe("local-only");
  });

  it("象限2（快进完成）→ up-to-date", () => {
    const status = deriveStatus(
      skill({
        lastMerge: {
          at: "2026-08-05T10:00:00Z",
          conflicts: [],
          quadrant: 2,
        },
      })
    );
    expect(status).toBe("up-to-date");
  });

  it("check 比 merge 新时以 check 为准", () => {
    const status = deriveStatus(
      skill({
        lastCheck: {
          at: "2026-08-05T12:00:00Z",
          localChanged: false,
          upstreamChanged: true,
        },
        lastMerge: {
          at: "2026-08-05T10:00:00Z",
          conflicts: [],
          quadrant: 1,
        },
      })
    );
    // 合并后上游又有了新版本
    expect(status).toBe("behind");
  });

  it("merge 比 check 新时以 merge 为准", () => {
    const status = deriveStatus(
      skill({
        lastCheck: {
          at: "2026-08-05T10:00:00Z",
          localChanged: false,
          upstreamChanged: true,
        },
        lastMerge: {
          at: "2026-08-05T12:00:00Z",
          conflicts: [],
          quadrant: 2,
        },
      })
    );
    // check 报的 behind 已被随后的 update 处理掉了
    expect(status).toBe("up-to-date");
  });

  it("冲突后又 check 且上游已无新内容 → 不再报 conflicted", () => {
    const status = deriveStatus(
      skill({
        lastCheck: {
          at: "2026-08-05T12:00:00Z",
          localChanged: true,
          upstreamChanged: false,
        },
        lastMerge: {
          at: "2026-08-05T10:00:00Z",
          conflicts: ["SKILL.md"],
          quadrant: 4,
        },
      })
    );
    // 冲突可能已被手工解决，以更近的观测为准
    expect(status).toBe("local-only");
  });
});
