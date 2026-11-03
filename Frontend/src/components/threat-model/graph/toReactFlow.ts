import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { Severity } from "@/lib/severity";
import type { Attack, ControlInfo, Finding, GraphEdge, GraphNode } from "@/types/ThreatModel";
import {
  cyber,
  SCALE_X,
  SCALE_Y,
  SEVERITY_PATH,
  nodeSize,
  type PathSeverity,
} from "@/components/threat-model/graph/cyberGraphTheme";

// "danger" = primary FH-001 route (critical-red, labelled, animated); "finding"
// = any other path colored by its severity; the rest are solution-view states:
// "blocked"/"mitigated" mark hops a control actually acts on (total / partial),
// "neutralized" marks a hop left safe only by an upstream cut (dim, no badge).
export type EdgeVariant = "danger" | "finding" | "blocked" | "mitigated" | "neutralized" | "neutral";

/** Map the app's Severity scale onto the report's path-severity buckets ("none" → "info"). */
function toPathSeverity(s: Severity | undefined): PathSeverity | undefined {
  if (!s) return undefined;
  return s === "none" ? "info" : s;
}

export interface CyberNodeData extends Record<string, unknown> {
  gnode: GraphNode;
  /** Node sits on at least one attack path. */
  attacked: boolean;
  /** Rendering the mitigated (solution) graph. */
  solved: boolean;
  /** Protected target in the solution view — gets a padlock badge. */
  isProtected: boolean;
  /** Controls covering this node (with effect) — shown in the padlock tooltip. */
  controls: ControlInfo[];
  /** Localised heading for the padlock tooltip (e.g. "Recommended controls"). */
  controlsLabel: string;
  /** Localised per-effect tags shown next to each control in the tooltip. */
  effectLabels: EffectLabels;
}

export interface EffectLabels {
  total: string;
  partial: string;
}

export interface CyberEdgeData extends Record<string, unknown> {
  variant: EdgeVariant;
  capability?: string;
  label?: string;
  /** Severity bucket driving the path color in the findings view. */
  severity?: PathSeverity;
  /** Finding/route id shown on the primary route, e.g. "FH-001". */
  pathLabel?: string;
  /** Controls covering this hop (with effect) — shown in the padlock tooltip. */
  controls: ControlInfo[];
  /** Localised heading for the padlock tooltip (e.g. "Recommended controls"). */
  controlsLabel: string;
  /** Localised per-effect tags shown next to each control in the tooltip. */
  effectLabels: EffectLabels;
  dimmed?: boolean;
}

export type CyberNode = Node<CyberNodeData, "cyber">;
export type CyberEdge = Edge<CyberEdgeData>;

const key = (f: string, t: string) => `${f}->${t}`;

/** The strongest effect among a hop/node's controls: `total` (blocks) wins over
 * `partial` (reinforces), driving which glyph the padlock badge shows. Returns
 * `undefined` when the effect is unknown (e.g. the findings-view recommendations). */
export function dominantEffect(controls: ControlInfo[]): "total" | "partial" | undefined {
  if (controls.some((c) => c.effect === "total")) return "total";
  if (controls.some((c) => c.effect === "partial")) return "partial";
  return undefined;
}

const SEV_ORDER: Record<Attack["severity"], number> = { critical: 1, high: 0 };

// Scores clamp at 10, so many criticals tie on severity and score alone.
function compareAttacks(a: Attack, b: Attack): number {
  return (
    SEV_ORDER[b.severity] - SEV_ORDER[a.severity] ||
    b.score - a.score ||
    b.exposure - a.exposure ||
    a.nodes.length - b.nodes.length ||
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );
}

/** Attack chosen for the "play attack" sequence: highest severity and score, then
 * the route concentrating the most risk, then the most direct one. */
function primaryAttack(attacks: Attack[]): Attack | undefined {
  return attacks.reduce<Attack | undefined>((best, a) => (!best || compareAttacks(a, best) < 0 ? a : best), undefined);
}

/** Id of the primary FH-001 route (e.g. "FH-001"), for the "primary route" legend row. */
export function primaryRouteId(attacks: Attack[]): string {
  const a = primaryAttack(attacks);
  return a ? (a.label || a.id) : "";
}

/** Primary critical route (label + ordered node ids) for the path breakdown box. */
export function primaryRoute(attacks: Attack[]): { label: string; nodeIds: string[] } | null {
  const a = primaryAttack(attacks);
  return a ? { label: a.label || a.id, nodeIds: a.nodes } : null;
}

export interface FindingRoute {
  nodeIds: string[];
  edgeIds: string[];
}

// Prefer the finding's own edge ids (the backend lists every parallel edge of
// each hop); without them, match consecutive `path` pairs in either direction.
export function findingRoute(finding: Pick<Finding, "path" | "edges">, edges: GraphEdge[]): FindingRoute {
  const byId = new Map(edges.map((e) => [e.id, e]));
  let routeEdges = (finding.edges ?? []).flatMap((id) => byId.get(id) ?? []);
  if (routeEdges.length === 0) {
    const hops = new Set<string>();
    finding.path.slice(0, -1).forEach((id, i) => {
      const next = finding.path[i + 1] ?? "";
      hops.add(key(id, next)).add(key(next, id));
    });
    routeEdges = edges.filter((e) => hops.has(key(e.f, e.t)));
  }
  const nodeIds = new Set(finding.path);
  routeEdges.forEach((e) => nodeIds.add(e.f).add(e.t));
  return { nodeIds: [...nodeIds], edgeIds: routeEdges.map((e) => e.id) };
}

export interface PlaybackFrame {
  currentNode: string | undefined;
  liveNodes: Set<string>;
  currentEdges: Set<string>;
  liveEdges: Set<string>;
}

// An edge lights up once both its ends are reached, which holds for parallel
// edges and for routes whose edges are not listed in path order.
export function playbackFrame(
  route: FindingRoute,
  step: number,
  edges: Pick<CyberEdge, "id" | "source" | "target">[],
): PlaybackFrame {
  const currentNode = route.nodeIds[step];
  const liveNodes = new Set(route.nodeIds.slice(0, step + 1));
  const routeEdgeIds = new Set(route.edgeIds);
  const currentEdges = new Set<string>();
  const liveEdges = new Set<string>();
  for (const e of edges) {
    if (!routeEdgeIds.has(e.id) || !liveNodes.has(e.source) || !liveNodes.has(e.target)) continue;
    liveEdges.add(e.id);
    if (e.source === currentNode || e.target === currentNode) currentEdges.add(e.id);
  }
  return { currentNode, liveNodes, currentEdges, liveEdges };
}

/**
 * Resolve an edge's rendering. Mirrors the bhat_agentic_2026 report: in the
 * findings view every hop carrying a finding is colored by its severity, and the
 * primary FH-001 route additionally reads critical-red with a label. The solution
 * view keeps the neutralised (protected / cut) states.
 */
function resolveEdge(
  e: GraphEdge,
  solved: boolean,
  onAttackPath: boolean,
  onPrimaryRoute: boolean,
): { variant: EdgeVariant; severity?: PathSeverity } {
  if (solved) {
    // A control acts directly on this hop: total cut → blocked, partial → mitigated.
    if (e.blocked) return { variant: "blocked" };
    if (e.mitigated) return { variant: "mitigated" };
    // Was risky / on an attack path but no control touches it — it's safe only
    // because an upstream hop was cut. Read as a dim "neutralised" line with no
    // badge (a padlock here would carry an empty tooltip).
    if (e.riskLevel === "critical" || e.riskLevel === "high" || onAttackPath) return { variant: "neutralized" };
    return { variant: "neutral" };
  }
  if (onPrimaryRoute) return { variant: "danger", severity: "critical" };
  const hasFinding = (e.findingIds?.length ?? 0) > 0 || onAttackPath;
  if (hasFinding) return { variant: "finding", severity: toPathSeverity(e.riskLevel) ?? "info" };
  return { variant: "neutral" };
}

export interface BuiltGraph {
  nodes: CyberNode[];
  edges: CyberEdge[];
  /** Ordered node ids of the primary attack, for the play-attack animation. */
  attackNodeIds: string[];
  /** Ordered edge ids of the primary attack (best-effort; gaps skipped). */
  attackEdgeIds: string[];
}

export function buildGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  attacks: Attack[],
  solved: boolean,
  nodeControls: Record<string, ControlInfo[]> = {},
  edgeControls: Record<string, ControlInfo[]> = {},
  controlsLabel = "",
  effectLabels: EffectLabels = { total: "", partial: "" },
): BuiltGraph {
  const attackedNodeIds = new Set<string>();
  const attackPairs = new Set<string>();
  attacks.forEach((a) => {
    a.nodes.forEach((id) => attackedNodeIds.add(id));
    a.nodes.slice(0, -1).forEach((id, i) => attackPairs.add(key(id, a.nodes[i + 1] ?? "")));
  });

  // Padlock targets: the terminal node(s) of attack paths, once solved.
  const protectedTargets = new Set<string>();
  if (solved) attacks.forEach((a) => { const last = a.nodes.at(-1); if (last) protectedTargets.add(last); });

  // Primary FH-001 route: the highest-severity attack's hop sequence. Its edges
  // read critical-red and carry the route label (e.g. "FH-001").
  const attack = primaryAttack(attacks);
  const primaryRoutePairs = new Set<string>();
  (attack?.nodes ?? []).slice(0, -1).forEach((id, i) => primaryRoutePairs.add(key(id, attack!.nodes[i + 1] ?? "")));
  const primaryLabel = attack ? (attack.label || attack.id) : "";

  const rfNodes: CyberNode[] = nodes
    .filter((n) => n.type !== "control")
    .map((n) => {
      const { w, h } = nodeSize(n.type);
      return {
      id: n.id,
      type: "cyber" as const,
      position: { x: n.x * SCALE_X - w / 2, y: n.y * SCALE_Y - h / 2 },
      data: {
        gnode: n,
        attacked: attackedNodeIds.has(n.id),
        solved,
        isProtected: protectedTargets.has(n.id),
        controls: nodeControls[n.id] ?? [],
        controlsLabel,
        effectLabels,
      },
      // Protected nodes sit above neighbours so the padlock stays reachable.
      zIndex: protectedTargets.has(n.id) ? 6 : 1,
    };
    });

  const edgeIdByPair = new Map<string, string>();
  const rfEdges: CyberEdge[] = edges.map((e) => {
    const pairKey = key(e.f, e.t);
    edgeIdByPair.set(pairKey, e.id);
    const onAttackPath = attackPairs.has(pairKey);
    const onPrimaryRoute = primaryRoutePairs.has(pairKey);
    const { variant, severity } = resolveEdge(e, solved, onAttackPath, onPrimaryRoute);
    const markerColor =
      variant === "danger" ? SEVERITY_PATH.critical.color
      : variant === "finding" ? SEVERITY_PATH[severity ?? "info"].color
      : variant === "mitigated" ? cyber.mitigated
      : variant === "blocked" || variant === "neutralized" ? cyber.protected
      : cyber.edgeDefault;
    return {
      id: e.id,
      source: e.f,
      target: e.t,
      type: "cyber",
      data: {
        variant,
        capability: e.capability,
        label: e.lbl,
        severity,
        pathLabel: onPrimaryRoute ? primaryLabel : undefined,
        controls: edgeControls[e.id] ?? [],
        controlsLabel,
        effectLabels,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: markerColor, width: 16, height: 16 },
      zIndex: variant === "danger" ? 3 : variant === "blocked" || variant === "mitigated" || variant === "finding" ? 2 : variant === "neutralized" ? 1 : 0,
    };
  });

  const attackNodeIds = attack?.nodes ?? [];
  const attackEdgeIds = attackNodeIds
    .slice(0, -1)
    .map((id, i) => edgeIdByPair.get(key(id, attackNodeIds[i + 1] ?? "")))
    .filter((id): id is string => Boolean(id));

  return { nodes: rfNodes, edges: rfEdges, attackNodeIds, attackEdgeIds };
}
