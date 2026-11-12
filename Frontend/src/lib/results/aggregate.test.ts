import { describe, expect, it } from "vitest";

import { aggregateResults } from "./aggregate";
import type { AnalysisListItem } from "@/lib/api/types";

function item(
  id: string,
  framework: string,
  summary: Partial<AnalysisListItem["summary"]> = {},
): AnalysisListItem {
  return {
    analysis_id: id,
    name: `Test ${id}`,
    source_framework: framework,
    uploaded_at: "2026-01-01T00:00:00+00:00",
    summary: {
      nodes: 5,
      edges: 4,
      findings: 0,
      critical: 0,
      high: 0,
      medium: 0,
      max_score: 0,
      ...summary,
    } as AnalysisListItem["summary"],
    warnings: [],
  };
}

describe("aggregateResults", () => {
  it("returns all-zero metrics for an empty list", () => {
    const agg = aggregateResults([]);
    expect(agg).toMatchObject({
      totalTests: 0,
      totalFindings: 0,
      totalCritical: 0,
      criticalRate: 0,
      avgMaxScore: 0,
      worstTests: [],
      byFramework: [],
    });
  });

  it("sums findings and counts tests carrying a critical", () => {
    const agg = aggregateResults([
      item("a", "crewai", { findings: 3, critical: 1, high: 1, max_score: 9 }),
      item("b", "crewai", { findings: 2, high: 2, max_score: 6 }),
    ]);

    expect(agg.totalTests).toBe(2);
    expect(agg.totalFindings).toBe(5);
    expect(agg.totalCritical).toBe(1);
    expect(agg.totalHigh).toBe(3);
    expect(agg.testsWithCritical).toBe(1);
    expect(agg.criticalRate).toBe(50);
    expect(agg.avgMaxScore).toBe(7.5);
  });

  it("derives low findings as the remainder of the severity split", () => {
    const agg = aggregateResults([
      item("a", "langgraph", { findings: 10, critical: 1, high: 2, medium: 3 }),
    ]);
    expect(agg.byFramework[0]).toMatchObject({ framework: "langgraph", low: 4 });
  });

  it("never derives a negative low count when the split exceeds the total", () => {
    const agg = aggregateResults([item("a", "generic", { findings: 1, critical: 2, high: 2 })]);
    expect(agg.byFramework[0]).toMatchObject({ low: 0 });
  });

  it("ranks worst tests by critical, then max score, then findings", () => {
    const agg = aggregateResults([
      item("low-score", "generic", { findings: 1, critical: 1, max_score: 5 }),
      item("high-score", "generic", { findings: 1, critical: 1, max_score: 9 }),
      item("no-critical", "generic", { findings: 9, max_score: 10 }),
    ]);
    expect(agg.worstTests.map((t) => t.id)).toEqual(["high-score", "low-score", "no-critical"]);
  });

  it("caps the ranking at five tests", () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`a${i}`, "generic", { findings: 1 }));
    expect(aggregateResults(items).worstTests).toHaveLength(5);
  });

  it("groups by framework and sorts by finding volume", () => {
    const agg = aggregateResults([
      item("a", "crewai", { findings: 1 }),
      item("b", "langgraph", { findings: 5, critical: 1 }),
      item("c", "crewai", { findings: 2 }),
    ]);

    expect(agg.byFramework.map((f) => f.framework)).toEqual(["langgraph", "crewai"]);
    expect(agg.byFramework[1]).toMatchObject({ framework: "crewai", tests: 2, findings: 3 });
  });

  it("collapses each test to its worst severity", () => {
    const agg = aggregateResults([
      item("crit", "generic", { findings: 2, critical: 1 }),
      item("high", "generic", { findings: 2, high: 1 }),
      item("med", "generic", { findings: 2, medium: 1 }),
      item("low", "generic", { findings: 1 }),
      item("clean", "generic", {}),
    ]);
    const bySeverity = Object.fromEntries(agg.worstTests.map((t) => [t.id, t.severity]));
    expect(bySeverity).toMatchObject({ crit: "critical", high: "high", med: "medium", low: "low" });
  });
});
