import { describe, expect, it } from "vitest";
import { buildSearchIndex, filterFindings, isFiltering, normalizeSearch } from "./findingSearch";
import type { Finding } from "@/types/ThreatModel";

const make = (over: Partial<Finding>): Finding => ({
  id: "f1",
  ruleId: "FH-001",
  severity: "high",
  category: "capability_path",
  title: "Destructive modification",
  desc: "",
  path: ["a", "b"],
  score: 8,
  findingClass: "attack",
  groupId: "g1",
  ...over,
});

const findings = [
  make({ id: "f1", ruleId: "FH-011" }),
  make({ id: "f2", ruleId: "FH-011", severity: "critical" }),
  make({ id: "f3", ruleId: "FH-019", title: "Sensitive data exposure", category: "trust_boundary", path: ["b"] }),
];
const labels = new Map([["f1", "FH-011 #1"], ["f2", "FH-011 #2"], ["f3", "FH-019"]]);
const nodes = new Map([["a", { label: "ticket_intake" }], ["b", { label: "Customer Records" }]]);
const index = buildSearchIndex(findings, labels, nodes);
const none = new Set<never>();
const run = (query: string, severities: ReadonlySet<Finding["severity"]> = none) =>
  filterFindings(findings, { query, severities }, index).map((f) => f.id);

describe("filterFindings", () => {
  it("returns everything without a query or severity", () => {
    expect(run("  ")).toEqual(["f1", "f2", "f3"]);
    expect(isFiltering({ query: " ", severities: none })).toBe(false);
  });

  it("finds an FH by its label, ignoring case", () => {
    expect(run("fh-011")).toEqual(["f1", "f2"]);
    expect(run("FH-011 #2")).toEqual(["f2"]);
    expect(run("FH-019")).toEqual(["f3"]);
  });

  it("matches the internal id, title, category and route labels", () => {
    expect(run("f3")).toEqual(["f3"]);
    expect(run("sensitive")).toEqual(["f3"]);
    expect(run("trust boundary")).toEqual(["f3"]);
    expect(run("ticket intake")).toEqual(["f1", "f2"]);
    expect(run("ticket_intake")).toEqual(["f1", "f2"]);
  });

  it("requires every term and ignores accents", () => {
    expect(run("fh-011 customer")).toEqual(["f1", "f2"]);
    expect(run("fh-011 sensitive")).toEqual([]);
    expect(normalizeSearch("Ruta Crítica")).toBe("ruta critica");
    expect(normalizeSearch("Auditoría ÚNICA")).toBe("auditoria unica");
  });

  it("leaves the severity to the filters instead of the untranslated text", () => {
    expect(run("critical")).toEqual([]);
  });

  it("combines the text with the severity filter", () => {
    expect(run("", new Set(["critical"]))).toEqual(["f2"]);
    expect(run("fh-011", new Set(["high"]))).toEqual(["f1"]);
  });
});
