import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { buildYamlExport } from "./threatModelExport";
import type { AnalysisResult } from "@/lib/api/adapters";
import type { Finding } from "@/types/ThreatModel";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    ruleId: "FH-001",
    severity: "critical",
    score: 9.1,
    title: "Agent can exfiltrate data",
    desc: "",
    category: "attack",
    findingClass: "attack",
    groupId: "g1",
    path: [],
    evidence: {},
    ...overrides,
  } as Finding;
}

function result(findings: Finding[]): AnalysisResult {
  return {
    analysisId: "a1",
    name: "Test",
    counts: { agents: 2, tools: 1, dataAssets: 1, findings: findings.length, critical: 1, high: 0, medium: 0, low: 0, maxScore: 9.1 },
    findings,
    nodes: [],
    edges: [],
    attacks: [],
    solution: null,
  } as unknown as AnalysisResult;
}

describe("buildYamlExport", () => {
  it("produces a parseable document with the analysis and findings", () => {
    const parsed = parse(buildYamlExport("findings", result([finding()])));

    expect(parsed.analysis.analysis_id).toBe("a1");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].rule_id).toBe("FH-001");
    expect(parsed.findings[0].status).toBeUndefined();
  });

  it("marks findings as resolved in solution mode", () => {
    const parsed = parse(buildYamlExport("solution", result([finding()])));
    expect(parsed.findings[0].status).toBe("resolved");
  });

  it.each([
    ['double quotes', 'Agent reads "secrets"'],
    ["a colon", "Risk: data exfiltration"],
    ["a newline", "Agent reads secrets\nand exfiltrates them"],
    ["a leading dash", "- not a list item"],
    ["a trailing backslash", "path\\"],
  ])("round-trips a title containing %s", (_label, title) => {
    const parsed = parse(buildYamlExport("findings", result([finding({ title })])));
    expect(parsed.findings[0].title).toBe(title);
  });

  it("handles an empty findings list", () => {
    const parsed = parse(buildYamlExport("findings", result([])));
    expect(parsed.findings).toEqual([]);
  });
});
