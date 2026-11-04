/**
 * Map the backend's raw (snake_case) shapes to the camelCase UI types in
 * `@/types/ThreatModel`.
 *
 * The backend returns the *logical* graph only — it carries no layout
 * coordinates (spec section 12.2 defines none). {@link toGraphNodes} therefore
 * assigns each node an `x`/`y` with a simple swimlane heuristic: one vertical
 * lane per node type (untrusted input → agents → tools/data → external output),
 * stacking nodes evenly within each lane. The lane x-positions line up with the
 * static backdrop columns drawn by `CapabilityGraph`.
 */

import { formatSnakeCase, formatValue, listItems } from "@/lib/format";
import { findingLabels } from "@/lib/results/findingDisplay";
import type { Severity } from "@/lib/severity";
import type {
  Attack,
  ControlEffect,
  ControlInfo,
  Finding,
  GraphEdge,
  GraphNode,
  NodeType,
  RemediationStep,
} from "@/types/ThreatModel";
import type {
  AnalysisListItem,
  AnalyzeRequest,
  AnalyzeResponse,
  BackendFinding,
  BackendGraph,
  BackendGraphEdge,
  BackendGraphNode,
  BackendSummary,
  ControlRecommendation,
  CoverageWarning,
  CreateAnalysisResponse,
  FindingDetailResponse,
  FindingsResponse,
  SimulateControlsResponse,
} from "./types";

// --- scalar mappings ---------------------------------------------------------

const EDGE_SEVERITY: Record<string, Severity> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  info: "none",
};

function toEdgeSeverity(raw: string): Severity {
  return EDGE_SEVERITY[raw] ?? "none";
}

// A finding is always at least a low-severity signal; backend `info` (if it ever
// occurs) is surfaced as `low` so it renders with a valid severity style.
const FINDING_SEVERITY: Record<string, Severity> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  info: "low",
};

function toFindingSeverity(raw: string): Severity {
  return FINDING_SEVERITY[raw] ?? "low";
}

function toNodeType(raw: string): NodeType {
  return raw === "data_asset" ? "data" : (raw as NodeType);
}

// --- analyses list -----------------------------------------------------------

/** One row of the stored-analyses list (`GET /analyses`), in UI shape. */
export interface AnalysisSummaryItem {
  id: string;
  name: string;
  /** Detected source framework (e.g. `crewai`, `generic`). */
  framework: string;
  /** Upload timestamp, ISO 8601 — the caller formats it for display. */
  uploadedAt: string;
  findings: number;
  /** Worst severity present in the summary, collapsed to one badge value. */
  severity: Severity;
}

/** Collapse a summary's finding counts to the single worst severity, so the
 * list row shows one badge. `none` means the analysis has no findings. */
export function summarySeverity(s: BackendSummary): Severity {
  if (s.critical > 0) return "critical";
  if (s.high > 0) return "high";
  if (s.medium > 0) return "medium";
  if (s.findings > 0) return "low";
  return "none";
}

export function toAnalysisSummaryItem(item: AnalysisListItem): AnalysisSummaryItem {
  return {
    id: item.analysis_id,
    name: item.name,
    framework: item.source_framework,
    uploadedAt: item.uploaded_at,
    findings: item.summary.findings,
    severity: summarySeverity(item.summary),
  };
}

// `AppliedControl.effect` is a free-form backend string; normalise it to the
// two effects the UI renders, defaulting to `unknown` for anything unexpected.
function toControlEffect(raw: string): ControlEffect {
  return raw === "total" || raw === "partial" ? raw : "unknown";
}

/** Inverse of {@link toNodeType}: the UI `data` type maps back to the backend
 * `data_asset`; every other type is shared verbatim. */
function toBackendNodeType(type: NodeType): string {
  return type === "data" ? "data_asset" : type;
}

function riskFromScore(score: number): "high" | "medium" | undefined {
  if (score >= 9) return "high";
  if (score >= 6) return "medium";
  return undefined;
}

// --- findings ----------------------------------------------------------------

export function toFinding(f: BackendFinding): Finding {
  return {
    id: f.id,
    ruleId: f.rule_id,
    severity: toFindingSeverity(f.severity),
    category: f.category,
    title: f.title,
    desc: f.derivation,
    path: f.path,
    edges: f.edges,
    score: f.score,
    evidence: f.evidence as Finding["evidence"],
    owaspAgentic: f.owasp_agentic,
    owaspLlm: f.owasp_llm,
    mitre: f.mitre_atlas,
    controls: f.recommended_controls,
    findingClass: f.finding_class,
    groupId: f.group_id,
  };
}

// --- graph nodes + swimlane layout -------------------------------------------

// x-position of each lane, aligned with the backdrop columns in CapabilityGraph
// (dashed lines at 135 / 565 / 1015 / 1195 within a 1460-wide viewBox).
const LANE_X: Record<NodeType, number> = {
  input: 90,
  agent: 330,
  memory: 470,
  tool: 660,
  data: 900,
  control: 1100,
  output: 1320,
};

const LANE_TOP = 70;
const LANE_BOTTOM = 540;

function nodeSub(type: NodeType, props: Record<string, unknown>): string | undefined {
  const show = (value: unknown, prefix: string): string | undefined => {
    const text = formatValue(value);
    return text === "" ? undefined : `${prefix}: ${text}`;
  };
  // Every tool is invoked, so invokeTool only adds information on its own.
  const withoutInvoke = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    const kinds = listItems(value);
    return kinds.some((k) => k !== "invokeTool") ? kinds.filter((k) => k !== "invokeTool") : kinds;
  };
  switch (type) {
    case "input":
      return show(props.trust_level, "trust");
    case "agent":
      return show(props.autonomy_level, "autonomy") ?? show(props.role_type, "role");
    case "tool":
      // Generic-format tools may omit capability_kinds; framework adapters always infer it.
      return show(withoutInvoke(props.capability_kinds), "capability") ?? show(props.operation_kind, "operation");
    case "data":
      return show(props.sensitivity, "sensitivity");
    case "output":
      return show(props.boundary, "boundary");
    case "memory":
      return show(props.scope, "scope");
    default:
      return undefined;
  }
}

export function toGraphNodes(backend: BackendGraphNode[]): GraphNode[] {
  const typed = backend.map((n) => ({ raw: n, type: toNodeType(n.type) }));

  // Assign y within each lane by stacking nodes of the same type evenly.
  const byLane = new Map<NodeType, typeof typed>();
  for (const item of typed) {
    const list = byLane.get(item.type) ?? [];
    list.push(item);
    byLane.set(item.type, list);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [type, items] of byLane) {
    const x = LANE_X[type] ?? 700;
    items.forEach((item, i) => {
      const y = LANE_TOP + ((i + 1) * (LANE_BOTTOM - LANE_TOP)) / (items.length + 1);
      pos.set(item.raw.id, { x, y });
    });
  }

  return typed.map(({ raw, type }) => {
    const { x, y } = pos.get(raw.id) ?? { x: 700, y: 300 };
    return {
      id: raw.id,
      type,
      label: raw.label,
      sub: nodeSub(type, raw.properties),
      x,
      y,
      risk: riskFromScore(raw.risk_score),
      riskScore: raw.risk_score,
      badges: raw.badges,
      properties: raw.properties,
    };
  });
}

// --- graph edges -------------------------------------------------------------

export function toGraphEdges(backend: BackendGraphEdge[]): GraphEdge[] {
  return backend.map((e) => ({
    id: e.id,
    f: e.source,
    t: e.target,
    lbl: e.label,
    capability: e.capability,
    riskLevel: toEdgeSeverity(e.risk_level),
    blocked: e.blocked,
    mitigated: e.mitigated,
    detected: e.detected,
    findingIds: e.finding_ids,
  }));
}

export interface FindingPathGraph {
  finding: Finding;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function toFindingPathGraph(detail: FindingDetailResponse): FindingPathGraph {
  return {
    finding: toFinding(detail.finding),
    nodes: toGraphNodes(detail.path_graph.nodes),
    edges: toGraphEdges(detail.path_graph.edges),
  };
}

// --- node property security signal (for the detail drawer) -------------------

// Properties that read as *safe* when truthy (a present control / guardrail)
// and *risky* when falsy.
const SAFE_WHEN_TRUE = new Set([
  "requires_approval",
  "approval_gate_present",
  "content_validated",
  "content_validation_present",
  "content_filtered",
  "sanitized",
  "url_allowlist",
  "pii_redaction_present",
  "audit_logging_enabled",
  "write_validated",
  "side_effect_reversible",
  "rollback_ready",
]);

// Properties that read as *risky* when truthy (an exposure the analysis flags).
const RISKY_WHEN_TRUE = new Set(["contains_pii", "gdpr_regulated", "side_effect"]);

function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * Classify a raw backend node property as a positive (safe/mitigated) or
 * negative (risky/missing) security signal, or `undefined` when it is merely
 * descriptive. Used to colour rows in the node detail drawer.
 */
export function propPositive(key: string, value: unknown): boolean | undefined {
  if (key === "guardrails") {
    if (Array.isArray(value)) return value.length > 0;
    return value ? true : false;
  }
  if (key === "trust_level") {
    if (value === "untrusted") return false;
    if (value === "internal" || value === "trusted") return true;
    return undefined;
  }
  const bool = asBool(value);
  if (bool === undefined) return undefined;
  if (SAFE_WHEN_TRUE.has(key)) return bool;
  if (RISKY_WHEN_TRUE.has(key)) return !bool;
  return undefined;
}

// --- attack overlays derived from findings -----------------------------------

/** Build the graph's attack-path overlays from critical/high findings: each
 * such finding's node path becomes a highlighted attack route. */
export function attacksFromFindings(findings: Finding[]): Attack[] {
  // Containment, not mere contact: findings on the shared entry/agent nodes touch every route.
  const exposure = (path: string[]) => {
    const nodes = new Set(path);
    const total = findings.reduce((sum, f) => (f.path.every((id) => nodes.has(id)) ? sum + f.score : sum), 0);
    return Number(total.toFixed(1));
  };
  const labels = findingLabels(findings);
  return findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .map((f) => ({
      id: f.id,
      severity: f.severity as Extract<Severity, "critical" | "high">,
      score: f.score,
      exposure: exposure(f.path),
      width: f.severity === "critical" ? 2.5 : 2,
      nodes: f.path,
      label: labels.get(f.id) ?? f.ruleId,
      dash: false,
    }));
}

// --- consolidated result -----------------------------------------------------

export interface AnalysisCounts {
  agents: number;
  tools: number;
  dataAssets: number;
  findings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  maxScore: number;
}

/** Before/after metrics for the Proposed Solution tab, shaped for direct
 * rendering (spec section 12.6). `riskScoreTotal` is the summed score of the
 * before-findings; `riskReductionPct` is the percentage drop (0–100), rounded. */
export interface BeforeAfter {
  before: { findingCount: number; criticalCount: number; maxScore: number; riskScoreTotal: number };
  after: { findingCount: number; criticalCount: number; maxScore: number; riskReductionPct: number };
}

/** The single highest-impact control recommendation (doc 03 §choke-point). */
export interface ChokepointRec {
  controlName: string;
  targetNodeLabel: string;
  /** Percentage of total risk score eliminated by this one control (0–100). */
  riskReductionPct: number;
  /** Number of finding paths broken by this control. */
  breaksFindingCount: number;
  costEstimate: string;
}

/** The live "Proposed Solution" payload: the recommended controls as a
 * remediation timeline, the before/after metrics, and the mitigated graph
 * (control nodes + blocked/mitigated edges) with the resolved attack paths. */
export interface SolutionResult {
  remediation: RemediationStep[];
  beforeAfter: BeforeAfter;
  nodes: GraphNode[];
  edges: GraphEdge[];
  attacks: Attack[];
  brokenFindingIds: string[];
  appliedControlCount: number;
  /** Controls actually applied by the simulation, keyed by their target node id,
   * each carrying its `effect` (total → blocks, partial → reinforces). Drives the
   * padlock tooltip + effect glyph in the solved graph. */
  nodeControlInfo: Record<string, ControlInfo[]>;
  /** The same applied controls keyed by each edge id they affect
   * (`AppliedControl.affected_edge_ids`), so a hop's tooltip lists exactly the
   * controls that cut or weaken *it*. */
  edgeControlInfo: Record<string, ControlInfo[]>;
  /** The top-ranked control recommendation; null when no recommendations exist. */
  chokepointRec: ChokepointRec | null;
}

export interface AnalysisResult {
  analysisId: string;
  name: string;
  counts: AnalysisCounts;
  findings: Finding[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  attacks: Attack[];
  /** Detected input format: `generic`, `crewai`, `dify` or `langgraph`. */
  sourceFramework: string;
  /** Rules the file's framework can't reach or only reaches once declared, and
   * declarations the adapter dropped. Always empty for the generic format. */
  warnings: CoverageWarning[];
  /** Populated once the Phase 2 recommend + simulate calls resolve; null while
   * loading or if they fail (the Findings tab stays usable either way). */
  solution: SolutionResult | null;
}

function countByBackendType(nodes: BackendGraphNode[], type: string): number {
  return nodes.filter((n) => n.type === type).length;
}

export function toAnalysisResult(
  create: CreateAnalysisResponse,
  graph: BackendGraph,
  findingsResponse: FindingsResponse,
): AnalysisResult {
  const anchorByGroup = new Map(findingsResponse.groups.map((g) => [g.group_id, g.anchor_node_id]));
  const findings = findingsResponse.findings.map((f) => ({ ...toFinding(f), groupAnchor: anchorByGroup.get(f.group_id) ?? undefined }));
  const summary: BackendSummary = create.summary;
  const low = Math.max(0, summary.findings - summary.critical - summary.high - summary.medium);
  return {
    analysisId: create.analysis_id,
    name: create.name,
    counts: {
      agents: countByBackendType(graph.nodes, "agent"),
      tools: countByBackendType(graph.nodes, "tool"),
      dataAssets: countByBackendType(graph.nodes, "data_asset"),
      findings: summary.findings,
      critical: summary.critical,
      high: summary.high,
      medium: summary.medium,
      low,
      maxScore: summary.max_score,
    },
    findings,
    nodes: toGraphNodes(graph.nodes),
    edges: toGraphEdges(graph.edges),
    attacks: attacksFromFindings(findings),
    sourceFramework: create.source_framework,
    warnings: create.warnings,
    solution: null,
  };
}

// --- analyze stage: build request + result from the (edited) graph -----------

/** Serialize the wizard's graph into an analyze request body, mapping the UI
 * shape back to the backend contract (`data` -> `data_asset`, `f`/`t` ->
 * `source`/`target`).
 *
 * The backend keeps the stored (authoritative) `properties` for any id it
 * already knows and only reads the ones sent here for genuinely NEW nodes/edges.
 * Nodes forward `n.properties` (a new node may carry UI-set fields); edges
 * intentionally always send `{}` because the UI `GraphEdge` carries no
 * properties (the graph serializer's `edge.properties` is not surfaced on the
 * UI type, and edges added in the modal have none) -- a new edge is empty by
 * design, and an existing edge's properties are preserved server-side by id.
 * Hence the deliberate node/edge asymmetry. */
export function toAnalyzeRequest(nodes: GraphNode[], edges: GraphEdge[]): AnalyzeRequest {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: toBackendNodeType(n.type),
      name: n.label,
      properties: n.properties ?? {},
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.f,
      target: e.t,
      capability: e.capability ?? e.lbl ?? "",
      properties: {},
    })),
  };
}

/** Build the results view from an analyze response. Reuses the create-time
 * mapper (the response carries the same summary/graph/findings), so counts,
 * nodes, edges and attack overlays are derived identically. `solution` is left
 * null; the caller recomputes the Proposed Solution against the analysis. */
export function toAnalyzedResult(resp: AnalyzeResponse): AnalysisResult {
  return toAnalysisResult(
    {
      analysis_id: resp.analysis_id,
      status: resp.status,
      name: resp.name,
      source_framework: resp.source_framework,
      summary: resp.summary,
      warnings: resp.warnings,
    },
    resp.graph,
    { findings: resp.findings, groups: resp.groups },
  );
}

// --- Phase 2: proposed solution ----------------------------------------------

function remediationDesc(rec: ControlRecommendation, breaksRuleIds: string[], riskScoreTotal: number): string[] {
  const parts = [`Cost: ${formatSnakeCase(rec.cost_estimate)}`];
  if (rec.estimated_risk_reduction > 0 && riskScoreTotal > 0) {
    const pct = Math.round((100 * rec.estimated_risk_reduction) / riskScoreTotal);
    parts.push(`Risk reduction: −${pct}%`);
  }
  if (breaksRuleIds.length > 0) {
    parts.push(`Resolves ${breaksRuleIds.join(", ")}`);
  } else {
    parts.push("Lowers the score of the paths it crosses");
  }
  return parts;
}

/** Map the ranked recommendations to remediation-timeline steps. Every
 * recommendation is applied in the simulation, so each step reads as done; the
 * title names the control and the node it sits on. `breaks_findings` carries
 * internal finding ids (e.g. `finding_001`), so they are resolved to the
 * human-facing rule ids (e.g. `FH-001`) and de-duplicated for display. */
export function toRemediationSteps(
  recommendations: ControlRecommendation[],
  nodeLabelById: Map<string, string>,
  ruleIdByFindingId: Map<string, string>,
  riskScoreTotal: number,
): RemediationStep[] {
  return recommendations.map((rec) => {
    const target = nodeLabelById.get(rec.target_node_id) ?? rec.target_node_id;
    const breaksRuleIds = Array.from(
      new Set(rec.breaks_findings.map((id) => ruleIdByFindingId.get(id) ?? id)),
    );
    return {
      title: `${rec.name} on ${target}`,
      desc: remediationDesc(rec, breaksRuleIds, riskScoreTotal),
      done: true,
    };
  });
}

/** Build the live Proposed Solution from a simulate-controls response plus the
 * recommendations that fed it. `base` supplies the pre-remediation findings
 * (for the before-side risk total) and the original attack overlays (filtered
 * to the paths the simulation actually broke). */
export function toSolutionResult(
  sim: SimulateControlsResponse,
  recommendations: ControlRecommendation[],
  base: AnalysisResult,
): SolutionResult {
  const nodeLabelById = new Map(base.nodes.map((n) => [n.id, n.label.replace(/\n/g, " ")]));
  const ruleIdByFindingId = new Map(base.findings.map((f) => [f.id, f.ruleId]));
  const findingById = new Map(base.findings.map((f) => [f.id, f]));
  const recByControlId = new Map(recommendations.map((r) => [r.control_id, r]));
  const riskScoreTotal = Number(base.findings.reduce((sum, f) => sum + f.score, 0).toFixed(1));
  const { percentage } = sim.risk_reduction;

  const brokenIds = new Set(sim.broken_paths.map((b) => b.finding_id));
  const attacks = base.attacks.filter((a) => brokenIds.has(a.id));

  // Fan each applied control out over the node it sits on and every edge it
  // touches, preserving its effect so the graph can distinguish the control that
  // *blocks* the route (total) from the ones that merely *reinforce* it (partial).
  const nodeControlInfo: Record<string, ControlInfo[]> = Object.create(null);
  const edgeControlInfo: Record<string, ControlInfo[]> = Object.create(null);
  const push = (map: Record<string, ControlInfo[]>, key: string, info: ControlInfo) => {
    const list = (map[key] ??= []);
    if (!list.some((c) => c.name === info.name && c.effect === info.effect)) list.push(info);
  };
  for (const ac of sim.applied_controls) {
    // The recommendation that led to this control being applied carries the
    // findings it breaks — surfaced in the padlock tooltip as the "why".
    const rec = recByControlId.get(ac.control_id);
    const relatedFindings = rec
      ?.breaks_findings.map((fid) => findingById.get(fid))
      .filter((f): f is Finding => Boolean(f))
      .map((f) => ({ ruleId: f.ruleId, title: f.title, severity: f.severity }));
    const info: ControlInfo = {
      name: ac.name,
      effect: toControlEffect(ac.effect),
      category: ac.category,
      findings: relatedFindings && relatedFindings.length > 0 ? relatedFindings : undefined,
    };
    if (ac.target_node_id) push(nodeControlInfo, ac.target_node_id, info);
    for (const edgeId of ac.affected_edge_ids) push(edgeControlInfo, edgeId, info);
  }

  const topRec = recommendations[0];
  const chokepointRec: ChokepointRec | null =
    topRec && riskScoreTotal > 0
      ? {
          controlName: topRec.name,
          targetNodeLabel: nodeLabelById.get(topRec.target_node_id) ?? topRec.target_node_id,
          riskReductionPct: Math.round((100 * topRec.estimated_risk_reduction) / riskScoreTotal),
          breaksFindingCount: topRec.breaks_findings.length,
          costEstimate: formatSnakeCase(topRec.cost_estimate),
        }
      : null;

  return {
    remediation: toRemediationSteps(recommendations, nodeLabelById, ruleIdByFindingId, riskScoreTotal),
    beforeAfter: {
      before: {
        findingCount: sim.before.finding_count,
        criticalCount: sim.before.critical_count,
        maxScore: sim.before.max_score,
        riskScoreTotal,
      },
      after: {
        findingCount: sim.after.finding_count,
        criticalCount: sim.after.critical_count,
        maxScore: sim.after.max_score,
        riskReductionPct: Math.round(percentage),
      },
    },
    nodes: toGraphNodes(sim.graph.nodes),
    edges: toGraphEdges(sim.graph.edges),
    attacks,
    brokenFindingIds: [...brokenIds],
    appliedControlCount: sim.applied_controls.length,
    nodeControlInfo,
    edgeControlInfo,
    chokepointRec,
  };
}
