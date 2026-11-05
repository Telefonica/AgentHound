import { describe, expect, it } from "vitest";

import { attacksFromFindings, toAnalysisResult, toGraphNodes } from "./adapters";
import type { BackendFinding, BackendGraphNode, FindingGroup } from "./types";
import type { Finding } from "@/types/ThreatModel";

function node(type: string, properties: Record<string, unknown>): BackendGraphNode {
  return {
    id: `${type}_1`,
    label: type,
    type,
    risk_score: 0,
    risk_level: "info",
    finding_ids: [],
    properties,
    badges: [],
  };
}

const sub = (type: string, properties: Record<string, unknown>) => toGraphNodes([node(type, properties)])[0]?.sub;

describe("toGraphNodes subtitle", () => {
  it("lists a tool's capability kinds", () => {
    expect(sub("tool", { capability_kinds: ["read", "search"], operation_kind: "read" })).toBe("capability: read, search");
  });

  it("drops invokeTool when the tool has another capability kind", () => {
    expect(sub("tool", { capability_kinds: ["deleteResource", "invokeTool"], operation_kind: "delete" })).toBe(
      "capability: deleteResource",
    );
    expect(sub("tool", { capability_kinds: ["invokeTool"], operation_kind: "invoke" })).toBe("capability: invokeTool");
  });

  it("falls back to the operation kind when a tool declares no capability kinds", () => {
    expect(sub("tool", { operation_kind: "invoke" })).toBe("operation: invoke");
    expect(sub("tool", { capability_kinds: [], operation_kind: "invoke" })).toBe("operation: invoke");
  });

  it("ignores capability kinds that are not non-empty strings", () => {
    expect(sub("tool", { capability_kinds: [{ verb: "send" }, "send"], operation_kind: "send" })).toBe("capability: send");
    expect(sub("tool", { capability_kinds: ["", ""], operation_kind: "invoke" })).toBe("operation: invoke");
  });

  it("does not let a blank or invalid item hide invokeTool", () => {
    expect(sub("tool", { capability_kinds: ["", "invokeTool"], operation_kind: "invoke" })).toBe("capability: invokeTool");
    expect(sub("tool", { capability_kinds: [{ verb: "send" }, "invokeTool"], operation_kind: "invoke" })).toBe(
      "capability: invokeTool",
    );
  });

  it("omits the subtitle when a tool has neither property", () => {
    expect(sub("tool", {})).toBeUndefined();
  });

  it("keeps the subtitle of the other node types", () => {
    expect(sub("input", { trust_level: "untrusted" })).toBe("trust: untrusted");
    expect(sub("data_asset", { sensitivity: "high" })).toBe("sensitivity: high");
  });
});

function finding(id: string, severity: Finding["severity"], score: number, path: string[]): Finding {
  return { id, ruleId: "FH-001", severity, category: "capability_path", title: id, desc: "", path, score, findingClass: "attack", groupId: id };
}

describe("attacksFromFindings", () => {
  const findings = [
    finding("f1", "critical", 10, ["input", "agent", "delete"]),
    finding("f2", "critical", 10, ["input", "agent", "update"]),
    finding("f3", "high", 8.8, ["delete"]),
    finding("f4", "medium", 4.8, ["delete"]),
    finding("f5", "low", 2.8, ["other"]),
  ];

  it("keeps only critical and high findings, with their score", () => {
    expect(attacksFromFindings(findings).map((a) => [a.id, a.score])).toEqual([
      ["f1", 10],
      ["f2", 10],
      ["f3", 8.8],
    ]);
  });

  it("sums the score of every finding, of any severity, that lies within the path", () => {
    expect(attacksFromFindings(findings).map((a) => [a.id, a.exposure])).toEqual([
      ["f1", 23.6],
      ["f2", 10],
      ["f3", 13.6],
    ]);
  });

  it("does not let findings on the shared entry nodes even out distinct routes", () => {
    const shared = [
      finding("cv", "critical", 10, ["form", "intake", "screener", "cv", "email"]),
      finding("web", "critical", 10, ["form", "intake", "researcher", "web", "email"]),
      finding("web-2", "critical", 10, ["form", "intake", "researcher", "web", "email"]),
      finding("entry", "high", 7.6, ["form"]),
    ];
    const [cv, web] = attacksFromFindings(shared);
    expect(web!.exposure).toBeGreaterThan(cv!.exposure);
  });

  it("labels each route like the prioritized list, numbering repeated rules", () => {
    const labelled = [...findings.slice(0, 2), { ...finding("f6", "high", 8.8, ["delete"]), ruleId: "FH-005" }];
    expect(attacksFromFindings(labelled).map((a) => a.label)).toEqual(["FH-001 #1", "FH-001 #2", "FH-005"]);
  });
});

describe("toAnalysisResult groups", () => {
  const backendFinding = (id: string, groupId: string, path: string[]): BackendFinding => ({
    id,
    rule_id: "FH-001",
    title: id,
    severity: "high",
    score: 8,
    category: "capability_path",
    path,
    edges: [],
    derivation: "",
    evidence: {},
    recommended_controls: [],
    owasp_agentic: [],
    owasp_llm: [],
    mitre_atlas: [],
    finding_class: "attack",
    group_id: groupId,
  });
  const group = (groupId: string, anchor: string | null): FindingGroup => ({
    group_id: groupId,
    rule_id: "FH-001",
    title: "",
    group_by: anchor ? "source" : "rule",
    anchor_node_id: anchor,
    finding_class: "attack",
    count: 1,
    max_score: 8,
    severity: "high",
    representative_finding_id: "",
    finding_ids: [],
  });

  it("carries the backend's group anchor onto each finding, and none for rule-wide groups", () => {
    const result = toAnalysisResult(
      { analysis_id: "a1", status: "done", name: "a", source_framework: "generic", warnings: [], summary: { nodes: 0, edges: 0, findings: 2, critical: 0, high: 2, medium: 0, max_score: 8 } },
      { nodes: [], edges: [] },
      {
        findings: [backendFinding("f1", "g1", ["in", "agent"]), backendFinding("f2", "g2", ["agent"])],
        groups: [group("g1", "in"), group("g2", null)],
      },
    );

    expect(result.findings.map((f) => [f.id, f.groupAnchor])).toEqual([
      ["f1", "in"],
      ["f2", undefined],
    ]);
  });
});
