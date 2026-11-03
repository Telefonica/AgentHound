import type { AnalysisResult } from "@/lib/api/adapters";
import type { Finding, GraphEdge, GraphNode } from "@/types/ThreatModel";

// f1 and f2 share a rule and differ in their last node, as real duplicates do.
export const nodes: GraphNode[] = [
  { id: "input", type: "input", label: "Email\nentrante", x: 0, y: 0 },
  { id: "planner", type: "agent", label: "Planner", x: 1, y: 0 },
  { id: "crm", type: "data", label: "CRM", x: 2, y: 0 },
  { id: "logs", type: "data", label: "Logs", x: 2, y: 1 },
];

export const edges: GraphEdge[] = [
  { id: "e1", f: "input", t: "planner" },
  { id: "e3", f: "planner", t: "crm" },
  { id: "e4", f: "planner", t: "logs" },
];

function finding(overrides: Partial<Finding> & Pick<Finding, "id" | "ruleId" | "groupId">): Finding {
  return {
    severity: "critical",
    category: "capability_path",
    title: "Datos sensibles alcanzables desde entrada no confiable",
    desc: "",
    path: ["input", "planner", "crm"],
    score: 9.1,
    findingClass: "attack",
    ...overrides,
  };
}

export const findings: Finding[] = [
  finding({ id: "f1", ruleId: "FH-001", groupId: "g1", groupAnchor: "input", edges: ["e1", "e3"] }),
  finding({ id: "f2", ruleId: "FH-001", groupId: "g1", groupAnchor: "input", path: ["input", "planner", "logs"], edges: ["e1", "e4"] }),
  finding({ id: "f3", ruleId: "FH-004", groupId: "g2", severity: "high", title: "Escritura en logs", path: ["planner", "logs"], edges: ["e4"], score: 7.2 }),
  finding({ id: "f4", ruleId: "HY-002", groupId: "g3", severity: "low", title: "Sin auditoría", path: [], edges: [], score: 2, findingClass: "hygiene" }),
];

export const result: AnalysisResult = {
  analysisId: "a1",
  name: "Soporte por email",
  counts: { agents: 1, tools: 0, dataAssets: 2, findings: 4, critical: 2, high: 1, medium: 0, low: 1, maxScore: 9.1 },
  findings,
  nodes,
  edges,
  attacks: [],
  solution: null,
};
