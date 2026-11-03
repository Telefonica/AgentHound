import { describe, expect, it } from "vitest";

import { findingLabels, groupFindings, routeSummary } from "./findingDisplay";

describe("findingLabels", () => {
  it("numbers findings that share a rule and leaves unique rules bare", () => {
    const labels = findingLabels([
      { id: "f1", ruleId: "FH-001" },
      { id: "f2", ruleId: "FH-002" },
      { id: "f3", ruleId: "FH-001" },
    ]);
    expect([...labels.entries()]).toEqual([
      ["f1", "FH-001 #1"],
      ["f2", "FH-002"],
      ["f3", "FH-001 #2"],
    ]);
  });
});

describe("routeSummary", () => {
  it("joins node labels, flattening line breaks and keeping unknown ids", () => {
    const nodes = new Map([
      ["a", { label: "User\ninput" }],
      ["b", { label: "Planner" }],
    ]);
    expect(routeSummary(["a", "b", "zz"], nodes)).toBe("User input → Planner → zz");
  });
});

describe("groupFindings", () => {
  it("collects findings by root cause, ordered by their first, highest-ranked occurrence", () => {
    const groups = groupFindings([
      { id: "f1", groupId: "g1" },
      { id: "f2", groupId: "g2" },
      { id: "f3", groupId: "g1" },
      { id: "f4", groupId: "g3" },
      { id: "f5", groupId: "g2" },
    ]);
    expect(groups.map((g) => [g.id, g.findings.map((f) => f.id)])).toEqual([
      ["g1", ["f1", "f3"]],
      ["g2", ["f2", "f5"]],
      ["g3", ["f4"]],
    ]);
  });

  it("returns no groups for no findings", () => {
    expect(groupFindings([])).toEqual([]);
  });
});
