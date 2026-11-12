import type { Severity } from "@/lib/severity";

export type NodeType = "input" | "agent" | "tool" | "data" | "output" | "control" | "memory";

export type ControlEffect = "total" | "partial" | "unknown";

export interface ControlInfo {
  name: string;
  effect: ControlEffect;
  /** Control category from the backend catalog (e.g. "input_validation"). */
  category?: string;
  /** Findings this control breaks/mitigates, for the padlock tooltip's "why" detail. */
  findings?: { ruleId: string; title: string; severity: Severity }[];
}

export type UploadStatus = "uploading" | "success" | "error";

export type WizardPhase = "configuration" | "processing" | "inference" | "results";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  sub?: string;
  x: number;
  y: number;
  risk?: "high" | "medium";
  /** Computed risk score (0-10), max score among findings whose path touches this node. */
  riskScore?: number;
  /** Short risk signals derived from node properties, e.g. "untrusted", "no_guardrails", "pii". */
  badges?: string[];
  status?: "present" | "absent";
  /** Raw backend node properties, surfaced in the detail drawer. */
  properties?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  f: string;
  t: string;
  lbl?: string;
  /** Neutral capability verb carried by this edge (e.g. "read", "send", "delegateTo"). */
  capability?: string;
  type?: "delegate" | "delegate2" | "return";
  cx?: number;
  cy?: number;
  /** Highest severity among findings whose path traverses this edge. */
  riskLevel?: Severity;
  /** Whether an applied control cuts this edge (total effect): the hop is
   * removed and any attack path through it disappears. False outside a solved graph. */
  blocked?: boolean;
  /** Whether an applied control weakens this edge (partial effect): the hop
   * survives but findings crossing it lose score. False outside a solved graph. */
  mitigated?: boolean;
  /** Whether a detector-effect control monitors this edge: the hop survives fully
   * but findings are flagged as under active detection. False outside a solved graph. */
  detected?: boolean;
  /** Ids of findings whose path traverses this edge. */
  findingIds?: string[];
}

export interface Attack {
  id: string;
  severity: Extract<Severity, "critical" | "high">;
  score: number;
  /** Summed score of every finding whose path lies entirely within this path. */
  exposure: number;
  width: number;
  nodes: string[];
  label: string;
  dash: boolean;
  cx?: number;
  cy?: number;
}

export type EvidenceValue = string | number | boolean | string[];

export interface Finding {
  id: string;
  /** Rule that produced this finding, e.g. "FH-001" (distinct from `id` once findings are sequential). */
  ruleId: string;
  /** Finding severity. Real backend data spans critical→low; the mock fixtures only use critical/high. */
  severity: Severity;
  /** Threat category, e.g. "capability_path", "trust_boundary_violation", "missing_control". */
  category: string;
  title: string;
  desc: string;
  path: string[];
  /** Ids of the specific edges (not just nodes) traversed by this finding's path. */
  edges?: string[];
  score: number;
  /** Structured facts backing the finding, e.g. { data_sensitivity: "critical", agent_count: 3 }. */
  evidence?: Record<string, EvidenceValue>;
  owaspAgentic?: string[];
  owaspLlm?: string[];
  mitre?: string[];
  controls?: string[];
  /** Derived channel: "attack" for exploitable paths, "hygiene" for compliance/monitoring gaps. */
  findingClass: "attack" | "hygiene";
  /** Root-cause group from the backend: repeated occurrences of one cause share it. */
  groupId: string;
  groupAnchor?: string;
}

export interface NodeProp {
  key: string;
  val: string;
  /** Security signal for this property: true = safe/mitigated, false = risky/missing, undefined = neutral/descriptive. */
  positive?: boolean;
}

export interface NodeDetail {
  description: string;
  properties: NodeProp[];
  findings: string[];
  controls: string[];
}

export interface RemediationStep {
  title: string;
  desc: string[];
  done: boolean;
}
