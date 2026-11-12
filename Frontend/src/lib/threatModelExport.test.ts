import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { buildMarkdownReport, buildYamlExport } from "./threatModelExport";
import type { AnalysisResult } from "@/lib/api/adapters";
import type { CoverageWarning } from "@/lib/api/types";
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

function result(findings: Finding[], warnings: CoverageWarning[] = []): AnalysisResult {
  return {
    analysisId: "a1",
    name: "Test",
    counts: { agents: 2, tools: 1, dataAssets: 1, findings: findings.length, critical: 1, high: 0, medium: 0, low: 0, maxScore: 9.1 },
    findings,
    nodes: [],
    edges: [],
    attacks: [],
    warnings,
    solution: null,
  } as unknown as AnalysisResult;
}

const warnings: CoverageWarning[] = [
  { kind: "not_expressible", rules: ["FH-015"], properties: [], message: "No adapter emits the interpretIntent verb." },
  {
    kind: "needs_declaration",
    rules: ["FH-025"],
    properties: ["boundary", "trust_level"],
    message: "Declare `boundary: external` (or `trust_level: untrusted`) on the data asset being read.",
  },
  {
    kind: "ignored_property",
    rules: [],
    properties: ["memroy"],
    message: "`memroy` on agent 'Planner' is not a known property and was ignored; did you mean `memory`?",
    node: "Planner",
    node_type: "agent",
    suggestion: "memory",
  },
];

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

  it("carries the coverage warnings", () => {
    const parsed = parse(buildYamlExport("findings", result([finding()], warnings)));
    expect(parsed.warnings).toEqual(warnings);
  });
});

describe("buildMarkdownReport", () => {
  it("lists the rules out of reach and the ignored properties with the backend's explanation", () => {
    const report = buildMarkdownReport(result([finding()], warnings), "findings");

    expect(report).toContain("## Rule coverage");
    expect(report).toContain("- **FH-015:** No adapter emits the interpretIntent verb.");
    expect(report).toContain("- **FH-025:** Declare `boundary: external` (or `trust_level: untrusted`)");
    expect(report).toContain("## Ignored properties\n\n- `memroy` on agent 'Planner'");
    expect(report.indexOf("## Rule coverage")).toBeLessThan(report.indexOf("## Findings"));
  });

  it("leaves the coverage sections out when there are no warnings", () => {
    const report = buildMarkdownReport(result([finding()]), "findings");

    expect(report).not.toContain("## Rule coverage");
    expect(report).not.toContain("## Ignored properties");
  });
});
