import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Box, Boxed, Inline, Stack, Text1, IconSearchRegular, skinVars } from "@telefonica/mistica";
import NodeDetailDrawer from "@/components/threat-model/NodeDetailDrawer";
import PrioritizedFindings from "@/components/threat-model/PrioritizedFindings";
import CyberGraph, { type CyberGraphHandle, type GraphHighlight } from "@/components/threat-model/graph/CyberGraph";
import { findingRoute, primaryRoute, primaryRouteId } from "@/components/threat-model/graph/toReactFlow";
import { NODE_STYLE } from "@/components/threat-model/graph/cyberGraphTheme";
import { routeSummary } from "@/lib/results/findingDisplay";
import { useFindingPathGraph } from "@/hooks/useFindingPathGraph";
import type { FindingPathGraph } from "@/lib/api/adapters";
import type { Attack, ControlInfo, Finding, GraphEdge, GraphNode } from "@/types/ThreatModel";

interface CapabilityGraphProps {
  analysisId: string;
  solved: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  findings: Finding[];
  attacks: Attack[];
  /** Analysis name, surfaced inside the canvas when it goes fullscreen. */
  name?: string;
  /** Number of controls applied in the simulated (solved) graph; drives the
   * "N controls applied" banner. Ignored when `solved` is false. */
  appliedControlCount?: number;
  /** Applied controls (with `effect`) per node/edge id, from the simulation.
   * When present (solved view) they replace the effect-less recommendations
   * derived from findings, so the tooltip shows what was actually applied and
   * whether each control blocks or reinforces the hop. */
  nodeControlInfo?: Record<string, ControlInfo[]>;
  edgeControlInfo?: Record<string, ControlInfo[]>;
  /** Switches the parent's Findings/Solution tab. Passed through to the canvas
   * toolbar so the view can be swapped without leaving fullscreen, where the
   * tabs above the graph aren't reachable. */
  onToggleView?: () => void;
  /** Whether the Proposed Solution tab has data to show; when it doesn't,
   * toggling into it must leave fullscreen so the "unavailable" notice is visible. */
  solutionAvailable?: boolean;
  findingLabelById: Map<string, string>;
  selectedFindingId: string | null;
  onSelectFinding: (id: string) => void;
  onClearSelection: () => void;
}

const NO_ATTACKS: Attack[] = [];

function CapabilityGraph({ analysisId, solved, nodes, edges, findings, attacks, name, appliedControlCount, nodeControlInfo, edgeControlInfo, onToggleView, solutionAvailable, findingLabelById, selectedFindingId, onSelectFinding, onClearSelection }: CapabilityGraphProps) {
  const t = useTranslations("results");
  const tNode = useTranslations("node");
  const [focusedNode, setFocusedNode] = useState<GraphNode | null>(null);
  const graphRef = useRef<CyberGraphHandle>(null);

  const selectedFinding = useMemo(
    () => (selectedFindingId ? findings.find((f) => f.id === selectedFindingId) ?? null : null),
    [findings, selectedFindingId],
  );
  const [isolated, setIsolated] = useState(false);
  if (isolated && (solved || !selectedFinding)) setIsolated(false);
  const pathGraph = useFindingPathGraph(analysisId, isolated ? selectedFindingId : null, findings);
  const readyGraph = pathGraph.status === "ready" ? pathGraph.graph : null;
  // While the next finding loads, keep the previous subgraph on screen (dimmed) instead of flashing the whole graph.
  const [lastGraph, setLastGraph] = useState<FindingPathGraph | null>(null);
  if (readyGraph && readyGraph !== lastGraph) setLastGraph(readyGraph);
  if (!isolated && lastGraph) setLastGraph(null);
  const isolatedGraph = readyGraph ?? (pathGraph.status === "loading" ? lastGraph : null);
  const stale = isolatedGraph !== null && isolatedGraph !== readyGraph;
  const graphNodes = isolatedGraph?.nodes ?? nodes;
  const graphEdges = isolatedGraph?.edges ?? edges;
  const graphFindings = useMemo(() => (isolatedGraph ? [isolatedGraph.finding] : findings), [isolatedGraph, findings]);

  // Recommended controls per node id, from the findings whose path runs through
  // it. Used as a fallback in the findings view; the solved view passes the
  // simulation's applied controls (with real effect) via `nodeControlInfo`.
  const nodeControls = useMemo(() => {
    if (nodeControlInfo) return nodeControlInfo;
    const map: Record<string, ControlInfo[]> = Object.create(null);
    for (const f of graphFindings) {
      const cs = f.controls ?? [];
      if (cs.length === 0) continue;
      for (const id of f.path) {
        const list = (map[id] ??= []);
        for (const c of cs) if (!list.some((x) => x.name === c)) list.push({ name: c, effect: "unknown" });
      }
    }
    return map;
  }, [graphFindings, nodeControlInfo]);

  // Primary critical route, built dynamically from the highest-severity attack:
  // its FH-id label plus the ordered nodes it traverses (mapped to real labels).
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const primaryPath = useMemo(() => {
    const route = primaryRoute(attacks);
    if (!route) return null;
    const steps = route.nodeIds
      .map((id) => nodesById.get(id))
      .filter((n): n is GraphNode => Boolean(n));
    return steps.length > 0 ? { label: route.label, steps } : null;
  }, [attacks, nodesById]);

  const highlight = useMemo<GraphHighlight | null>(() => {
    const finding = stale ? isolatedGraph.finding : selectedFinding;
    if (solved || !finding) return null;
    return {
      ...findingRoute(finding, graphEdges),
      label: findingLabelById.get(finding.id) ?? finding.ruleId,
      summary: routeSummary(finding.path, nodesById),
    };
  }, [solved, stale, isolatedGraph, selectedFinding, graphEdges, findingLabelById, nodesById]);

  // Recommended controls per edge id, from findings traversing that node pair.
  // As with `nodeControls`, the solved view overrides this with the simulation's
  // applied controls (with real effect) via `edgeControlInfo`.
  const edgeControls = useMemo(() => {
    if (edgeControlInfo) return edgeControlInfo;
    const pairToId = new Map<string, string>();
    for (const e of graphEdges) pairToId.set(`${e.f}->${e.t}`, e.id);
    const map: Record<string, ControlInfo[]> = Object.create(null);
    for (const f of graphFindings) {
      const cs = f.controls ?? [];
      if (cs.length === 0) continue;
      for (let i = 0; i < f.path.length - 1; i++) {
        const id = pairToId.get(`${f.path[i]}->${f.path[i + 1]}`);
        if (!id) continue;
        const list = (map[id] ??= []);
        for (const c of cs) if (!list.some((x) => x.name === c)) list.push({ name: c, effect: "unknown" });
      }
    }
    return map;
  }, [graphFindings, graphEdges, edgeControlInfo]);

  const labels = useMemo(() => ({
    playAttack: t("playAttack"),
    playRoute: (label: string) => t("playRoute", { id: label }),
    stop: t("stopAttack"),
    fit: t("fitView"),
    minimap: t("minimap"),
    fullscreen: t("fullscreen"),
    exitFullscreen: t("exitFullscreen"),
    viewFindings: t("tabFindings"),
    viewSolution: t("tabProposedSolution"),
    download: t("downloadPng"),
    legendSafe: t("legend.safe"),
    legendBlocked: t("legend.blocked"),
    legendMitigated: t("legend.mitigated"),
    legendPathSeverity: t("legend.pathSeverity"),
    legendPrimaryRoute: t("legend.primaryRoute", { id: primaryRouteId(attacks) }),
    legendCritical: t("legend.critical"),
    legendCriticalOnly: t("legend.criticalOnly"),
    legendHigh: t("legend.high"),
    legendMedium: t("legend.medium"),
    legendLow: t("legend.low"),
    legendInfo: t("legend.info"),
    legendNodeFindings: t("legend.nodeFindings"),
    legendNodeFinding: t("legend.nodeFinding"),
    legendNodeFindingSample: t("legend.nodeFindingSample"),
    legendNodeTypes: t("legend.nodeTypes"),
    nodeTypeLabel: {
      input: t("legend.node.input"),
      agent: t("legend.node.agent"),
      memory: t("legend.node.memory"),
      tool: t("legend.node.tool"),
      data: t("legend.node.data"),
      output: t("legend.node.output"),
    },
    recommendedControls: tNode("recommendedControls"),
    controlEffect: {
      total: tNode("controlEffect.total"),
      partial: tNode("controlEffect.partial"),
    },
    highlightedRoute: t("highlightedRoute"),
    playingRoute: t("playingRoute"),
    nextRoute: (label: string) => t("nextRoute", { id: label }),
    clearHighlight: t("clearHighlight"),
    isolateRoute: t("isolateRoute"),
    isolatingRoute: t("isolatingRoute"),
    showInContext: t("showInContext"),
    isolatedRoute: t("isolatedRoute"),
    retryIsolate: t("retryIsolate"),
    loadingIsolatedRoute: (label: string) => t("loadingIsolatedRoute", { id: label }),
    isolateError: t("isolateError"),
  }), [t, tNode, attacks]);

  const toggleIsolated = useCallback(() => setIsolated((v) => !v), []);

  return (
    <Stack space={12}>
      <Inline space={4} alignItems="center">
        <IconSearchRegular size={13} color={skinVars.colors.textSecondary} />
        <Text1 regular color={skinVars.colors.textSecondary}>{t("graphHint")}</Text1>
      </Inline>

      <CyberGraph
        ref={graphRef}
        solved={solved}
        nodes={graphNodes}
        edges={graphEdges}
        attacks={isolatedGraph ? NO_ATTACKS : attacks}
        findings={graphFindings}
        name={name}
        nodeControls={nodeControls}
        edgeControls={edgeControls}
        onNodeClick={setFocusedNode}
        onToggleView={onToggleView}
        solutionAvailable={solutionAvailable}
        highlight={highlight}
        onClearHighlight={onClearSelection}
        isolated={isolatedGraph !== null}
        onToggleIsolated={pathGraph.status === "error" ? pathGraph.retry : toggleIsolated}
        isolating={pathGraph.status === "loading"}
        isolateFailed={pathGraph.status === "error"}
        pendingRoute={stale && selectedFinding ? findingLabelById.get(selectedFinding.id) ?? selectedFinding.ruleId : null}
        labels={labels}
      />

      {!solved && !isolatedGraph && primaryPath && (
        <Boxed dataAttributes={{ testid: "primary-path" }}>
          <Box paddingX={16} paddingY={12}>
            <Stack space={8}>
              <Inline space={8} alignItems="center" wrap verticalSpace={4}>
                <span style={{ display: "block", width: 8, height: 8, borderRadius: "50%", background: skinVars.colors.error }} />
                <Text1 medium color={skinVars.colors.error}>{t("primaryPath")}</Text1>
                <span
                  style={{
                    padding: "1px 7px",
                    borderRadius: 999,
                    border: `1px solid ${skinVars.colors.error}`,
                    color: skinVars.colors.error,
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {primaryPath.label}
                </span>
              </Inline>
              <Inline space={4} alignItems="center" wrap verticalSpace={4}>
                {primaryPath.steps.map((n, i) => (
                  <Inline key={`${n.id}-${i}`} space={4} alignItems="center">
                    {i > 0 && <Text1 regular color={skinVars.colors.textSecondary}>→</Text1>}
                    <span style={{ display: "block", width: 7, height: 7, borderRadius: "50%", background: NODE_STYLE[n.type].accent }} />
                    <Text1 regular>{n.label.replace(/\n/g, " ")}</Text1>
                  </Inline>
                ))}
              </Inline>
            </Stack>
          </Box>
        </Boxed>
      )}

      {solved && (
        <Text1 medium color={skinVars.colors.success}>
          {t("solvedBanner", { count: appliedControlCount ?? 0 })}
        </Text1>
      )}

      {!solved && findings.length > 0 && (
        <PrioritizedFindings
          key={analysisId}
          findings={findings}
          findingLabelById={findingLabelById}
          nodesById={nodesById}
          selectedFindingId={selectedFindingId}
          onSelectFinding={onSelectFinding}
        />
      )}

      {focusedNode && (
        <NodeDetailDrawer
          node={focusedNode}
          findings={findings}
          findingLabelById={findingLabelById}
          nodesById={nodesById}
          onClose={() => {
            setFocusedNode(null);
            graphRef.current?.restoreFullscreen();
          }}
        />
      )}
    </Stack>
  );
}

export default CapabilityGraph;
