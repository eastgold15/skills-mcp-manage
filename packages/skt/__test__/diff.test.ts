import { describe, expect, it } from "bun:test";
import {
  conflictPaths,
  decideFiles,
  decideQuadrant,
  type FileMap,
  sameContent,
} from "../src/core/diff";

/** 便捷构造文件清单：{ 路径: 内容标记 } */
function fm(entries: Record<string, string>): FileMap {
  return new Map(Object.entries(entries));
}

describe("sameContent 清单比对", () => {
  it("内容与路径全同判为相同", () => {
    expect(sameContent(fm({ a: "1", b: "2" }), fm({ a: "1", b: "2" }))).toBe(
      true
    );
  });

  it("同一路径内容不同判为不同", () => {
    expect(sameContent(fm({ a: "1" }), fm({ a: "2" }))).toBe(false);
  });

  it("文件数不同判为不同", () => {
    expect(sameContent(fm({ a: "1" }), fm({ a: "1", b: "2" }))).toBe(false);
  });

  it("两个空清单判为相同", () => {
    expect(sameContent(fm({}), fm({}))).toBe(true);
  });
});

describe("decideQuadrant 四象限判定", () => {
  const base = fm({ "SKILL.md": "v1" });

  it("象限1：两边都没动 → 无需更新", () => {
    const v = decideQuadrant(
      base,
      fm({ "SKILL.md": "v1" }),
      fm({ "SKILL.md": "v1" })
    );
    expect(v.quadrant).toBe(1);
    expect(v.localChanged).toBe(false);
    expect(v.upstreamChanged).toBe(false);
  });

  it("象限2：只有上游变 → 快进", () => {
    const v = decideQuadrant(
      base,
      fm({ "SKILL.md": "v1" }),
      fm({ "SKILL.md": "v2" })
    );
    expect(v.quadrant).toBe(2);
  });

  it("象限3：只有本地变 → 保留本地", () => {
    const v = decideQuadrant(
      base,
      fm({ "SKILL.md": "mine" }),
      fm({ "SKILL.md": "v1" })
    );
    expect(v.quadrant).toBe(3);
  });

  it("象限4：两边都变 → 三路合并", () => {
    const v = decideQuadrant(
      base,
      fm({ "SKILL.md": "mine" }),
      fm({ "SKILL.md": "v2" })
    );
    expect(v.quadrant).toBe(4);
  });

  it("本地改动但上游没动，不应误报冲突（修正旧代码的核心 bug）", () => {
    const v = decideQuadrant(
      base,
      fm({ "SKILL.md": "mine" }),
      fm({ "SKILL.md": "v1" })
    );
    // 旧代码只比 ours 与记录哈希，这里会误判成冲突
    expect(v.quadrant).toBe(3);
    expect(v.upstreamChanged).toBe(false);
  });

  it("两边改成同样内容视为都未变", () => {
    const v = decideQuadrant(
      base,
      fm({ "SKILL.md": "same" }),
      fm({ "SKILL.md": "same" })
    );
    expect(v.quadrant).toBe(4);
    // 象限为4但逐文件判定应为 unchanged，见下面的用例
  });
});

describe("decideFiles 逐文件判定", () => {
  it("改动不同文件时各自自动合并，零冲突", () => {
    const base = fm({ "ref.md": "r1", "SKILL.md": "v1" });
    const ours = fm({ "ref.md": "my-r", "SKILL.md": "v1" });
    const theirs = fm({ "ref.md": "r1", "SKILL.md": "v2" });

    const v = decideFiles(base, ours, theirs);

    expect(v.get("SKILL.md")).toBe("take-theirs");
    expect(v.get("ref.md")).toBe("keep-ours");
    expect(conflictPaths(v)).toEqual([]);
  });

  it("同一文件两边都改且内容不同 → conflict", () => {
    const v = decideFiles(
      fm({ "SKILL.md": "v1" }),
      fm({ "SKILL.md": "mine" }),
      fm({ "SKILL.md": "v2" })
    );

    expect(v.get("SKILL.md")).toBe("conflict");
    expect(conflictPaths(v)).toEqual(["SKILL.md"]);
  });

  it("同一文件两边改成相同内容 → 不算冲突", () => {
    const v = decideFiles(
      fm({ "SKILL.md": "v1" }),
      fm({ "SKILL.md": "same" }),
      fm({ "SKILL.md": "same" })
    );

    expect(v.get("SKILL.md")).toBe("unchanged");
    expect(conflictPaths(v)).toEqual([]);
  });

  it("两边都没动 → unchanged", () => {
    const v = decideFiles(fm({ a: "1" }), fm({ a: "1" }), fm({ a: "1" }));
    expect(v.get("a")).toBe("unchanged");
  });

  it("上游新增文件 → added-upstream", () => {
    const v = decideFiles(
      fm({ a: "1" }),
      fm({ a: "1" }),
      fm({ a: "1", b: "2" })
    );
    expect(v.get("b")).toBe("added-upstream");
  });

  it("本地新增文件 → added-local，不会被上游抹掉", () => {
    const v = decideFiles(
      fm({ a: "1" }),
      fm({ a: "1", mine: "x" }),
      fm({ a: "1" })
    );
    expect(v.get("mine")).toBe("added-local");
  });

  it("两边新增同名但内容不同的文件 → conflict", () => {
    const v = decideFiles(fm({}), fm({ n: "mine" }), fm({ n: "theirs" }));
    expect(v.get("n")).toBe("conflict");
  });

  it("两边新增同名且内容相同 → unchanged", () => {
    const v = decideFiles(fm({}), fm({ n: "same" }), fm({ n: "same" }));
    expect(v.get("n")).toBe("unchanged");
  });

  it("上游删除且本地没改 → deleted-upstream", () => {
    const v = decideFiles(
      fm({ a: "1", old: "o" }),
      fm({ a: "1", old: "o" }),
      fm({ a: "1" })
    );
    expect(v.get("old")).toBe("deleted-upstream");
  });

  it("上游删除但本地改过 → delete-conflict，需人决定", () => {
    const v = decideFiles(
      fm({ a: "1", old: "o" }),
      fm({ a: "1", old: "my-edit" }),
      fm({ a: "1" })
    );
    expect(v.get("old")).toBe("delete-conflict");
    expect(conflictPaths(v)).toEqual(["old"]);
  });

  it("本地删除且上游没动 → unchanged（尊重本地删除）", () => {
    const v = decideFiles(
      fm({ a: "1", gone: "g" }),
      fm({ a: "1" }),
      fm({ a: "1", gone: "g" })
    );
    expect(v.get("gone")).toBe("unchanged");
  });

  it("本地删除但上游改过 → conflict", () => {
    const v = decideFiles(
      fm({ a: "1", gone: "g" }),
      fm({ a: "1" }),
      fm({ a: "1", gone: "upstream-edit" })
    );
    expect(v.get("gone")).toBe("conflict");
  });

  it("两边都删同一文件 → unchanged", () => {
    const v = decideFiles(
      fm({ a: "1", x: "x" }),
      fm({ a: "1" }),
      fm({ a: "1" })
    );
    expect(v.get("x")).toBe("unchanged");
  });

  it("嵌套路径同样参与判定", () => {
    const v = decideFiles(
      fm({ "refs/deep/a.md": "1" }),
      fm({ "refs/deep/a.md": "mine" }),
      fm({ "refs/deep/a.md": "theirs" })
    );
    expect(v.get("refs/deep/a.md")).toBe("conflict");
  });

  it("conflictPaths 同时收集 conflict 与 delete-conflict", () => {
    const v = decideFiles(
      fm({ both: "b", removed: "r" }),
      fm({ both: "mine", removed: "my-edit" }),
      fm({ both: "theirs" })
    );
    expect(conflictPaths(v).sort((a, b) => a.localeCompare(b))).toEqual([
      "both",
      "removed",
    ]);
  });
});
