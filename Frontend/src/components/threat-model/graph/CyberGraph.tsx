"use client";
import "@xyflow/react/dist/style.css";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { toPng } from "html-to-image";
import { Spinner, Tag, applyAlpha } from "@telefonica/mistica";
import type { Attack, ControlInfo, Finding, GraphEdge, GraphNode, NodeType } from "@/types/ThreatModel";
import { cyber, getSeverityPath, NODE_STYLE, useIsDarkMode, type PathSeverity } from "@/components/threat-model/graph/cyberGraphTheme";
import { GLYPH, nodeTypes } from "@/components/threat-model/graph/nodeTypes";
import { edgeTypes, SeverityPathContext } from "@/components/threat-model/graph/edgeTypes";
import { buildGraph, playbackFrame, primaryRouteId, type CyberNode, type FindingRoute } from "@/components/threat-model/graph/toReactFlow";
import { dagreLayout } from "@/components/threat-model/graph/dagreLayout";

/** Imperative handle so the parent (which owns the node-detail Drawer's open
 * state) can put the canvas back into fullscreen once the Drawer it forced
 * shut has fully closed. */
export interface CyberGraphHandle {
  restoreFullscreen: () => void;
}

export interface CyberGraphProps {
  solved: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  attacks: Attack[];
  findings?: Finding[];
  /** Analysis name, shown only in fullscreen: the page heading that normally
   * identifies the test is not visible once the canvas takes over the screen. */
  name?: string;
  /** Controls (with effect) per node id — surfaced in the node padlock tooltip. */
  nodeControls: Record<string, ControlInfo[]>;
  /** Controls (with effect) per edge id — surfaced in the path padlock tooltip. */
  edgeControls: Record<string, ControlInfo[]>;
  onNodeClick: (node: GraphNode) => void;
  /** Switches the parent's Findings/Solution tab; rendered as a toolbar button
   * inside the canvas so the view can be swapped without leaving fullscreen. */
  onToggleView?: () => void;
  /** Whether the Proposed Solution tab has data; toggling into it while false
   * leaves fullscreen so the "unavailable" notice above the canvas is visible. */
  solutionAvailable?: boolean;
  highlight?: GraphHighlight | null;
  onClearHighlight?: () => void;
  isolated?: boolean;
  onToggleIsolated?: () => void;
  isolating?: boolean;
  isolateFailed?: boolean;
  /** Label of the finding whose subgraph is loading while the previous one stays on screen. */
  pendingRoute?: string | null;
  labels: {
    playAttack: string;
    playRoute: (label: string) => string;
    stop: string;
    fit: string;
    fullscreen: string;
    exitFullscreen: string;
    viewFindings: string;
    viewSolution: string;
    download: string;
    legendSafe: string;
    legendBlocked: string;
    legendMitigated: string;
    legendPathSeverity: string;
    legendPrimaryRoute: string;
    legendCritical: string;
    legendCriticalOnly: string;
    legendHigh: string;
    legendMedium: string;
    legendLow: string;
    legendInfo: string;
    legendNodeFindings: string;
    legendNodeFinding: string;
    legendNodeFindingSample: string;
    legendNodeTypes: string;
    nodeTypeLabel: Record<Exclude<NodeType, "control">, string>;
    recommendedControls: string;
    /** Per-effect tag shown next to each control in the padlock tooltip. */
    controlEffect: { total: string; partial: string };
    highlightedRoute: string;
    playingRoute: string;
    nextRoute: (label: string) => string;
    clearHighlight: string;
    isolateRoute: string;
    isolatingRoute: string;
    showInContext: string;
    isolatedRoute: string;
    retryIsolate: string;
    loadingIsolatedRoute: (label: string) => string;
    isolateError: string;
  };
}

export interface GraphHighlight extends FindingRoute {
  label: string;
  summary: string;
}

type PlayedRoute = FindingRoute & { label: string; summary?: string };

// Grows with tall screens: large dagre layouts are bounded by height.
const CANVAS_H = "clamp(540px, 70vh, 820px)";
const NO_FINDINGS: Finding[] = [];
const LEGEND_SAMPLE_ZOOM = 0.65;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
// Fitting ignores the zoom floor, otherwise large graphs never fit whole.
const FIT_OPTIONS = { padding: 0.08, minZoom: 0 };
const ROUTE_FIT_OPTIONS = { padding: 0.3, minZoom: 0, maxZoom: 1.2 };
const fitDuration = () => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 400);
const TOOLBAR_CLEARANCE = 56;
const TITLE_GAP = 12;

// Safari still exposes the Fullscreen API under the webkit prefix, so fall back to
// the prefixed members when the standard ones are absent.
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };

function fullscreenElement(): Element | null {
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}
function requestFullscreen(el: FsElement) {
  void (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
}
function exitFullscreen() {
  const d = document as FsDocument;
  void (d.exitFullscreen ?? d.webkitExitFullscreen)?.call(d);
}

const Flow = forwardRef<CyberGraphHandle, CyberGraphProps>(function Flow(
  { solved, nodes, edges, attacks, findings = NO_FINDINGS, name, nodeControls, edgeControls, onNodeClick, onToggleView, solutionAvailable, highlight, onClearHighlight, isolated = false, onToggleIsolated, isolating = false, isolateFailed = false, pendingRoute = null, labels },
  ref,
) {
  const isDark = useIsDarkMode();
  const severityPath = useMemo(() => getSeverityPath(isDark), [isDark]);
  const built = useMemo(
    () => buildGraph(nodes, edges, attacks, solved, nodeControls, edgeControls, labels.recommendedControls, labels.controlEffect, findings),
    [nodes, edges, attacks, solved, nodeControls, edgeControls, labels.recommendedControls, labels.controlEffect, findings],
  );

  // Node types actually present in the graph, in reading order, for the legend.
  const presentTypes = useMemo(() => {
    const seen = new Set(nodes.map((n) => n.type));
    return NODE_TYPE_ORDER.filter((t) => seen.has(t));
  }, [nodes]);

  // Edge variants/severities actually present in the built graph, so the
  // path-severity legend only lists rows that appear on the canvas.
  const legendState = useMemo(() => {
    const severities = new Set<PathSeverity>();
    let hasPrimaryRoute = false;
    let hasBlocked = false;
    let hasMitigated = false;
    let hasSafe = false;
    built.edges.forEach((e) => {
      const variant = e.data?.variant;
      if (variant === "danger") hasPrimaryRoute = true;
      else if (variant === "finding" && e.data?.severity) severities.add(e.data.severity);
      else if (variant === "blocked") hasBlocked = true;
      else if (variant === "mitigated") hasMitigated = true;
      // "neutralized" (safe by an upstream cut) and "neutral" both read as safe.
      else if (variant === "neutralized" || variant === "neutral") hasSafe = true;
    });
    const hasNodeFinding = built.nodes.some((n) => n.data.findingMark);
    const hasPathRows = hasPrimaryRoute || severities.size > 0 || hasSafe;
    return { severities, hasPrimaryRoute, hasBlocked, hasMitigated, hasSafe, hasPathRows, hasNodeFinding };
  }, [built.edges, built.nodes]);

  // Refine node positions with a dagre `layered` layout (React Flow's official
  // dagre approach): dagre reorders nodes within their type-column to minimise
  // edge crossings; we keep the curved edges. Computed synchronously as
  // derived state (dagre, unlike the previous elkjs layout, has no async step)
  // so the first paint already shows the final layout instead of flashing the
  // swimlane fallback from buildGraph.
  const dagrePositions = useMemo(() => {
    const real = nodes.filter((n) => n.type !== "control");
    return real.length > 0 ? dagreLayout(real, edges) : new Map<string, { x: number; y: number }>();
  }, [nodes, edges]);
  const layoutedNodes = useMemo(
    () => built.nodes.map((n) => (dagrePositions.has(n.id) ? { ...n, position: dagrePositions.get(n.id)! } : n)),
    [built.nodes, dagrePositions],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(built.edges);
  const [playback, setPlayback] = useState<{ route: PlayedRoute; step: number; run: number } | null>(null);
  const playRuns = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const { getNodes, fitView } = useReactFlow();

  // Zoom at which the whole graph fits; the floor drops to it so wheel zoom
  // does not snap back past a fit on large graphs. It uses the route padding,
  // the larger one, so a route's fit never lands below it either.
  const fitZoom = useStore((s) => {
    if (!s.width || !s.height || s.nodeLookup.size === 0) return MIN_ZOOM;
    const bounds = getNodesBounds([...s.nodeLookup.keys()], { nodeLookup: s.nodeLookup });
    return getViewportForBounds(bounds, s.width, s.height, 0, MAX_ZOOM, ROUTE_FIT_OPTIONS.padding).zoom;
  });
  const minZoom = Math.min(MIN_ZOOM, fitZoom);

  // Native Fullscreen API on the canvas wrapper — this covers the whole
  // screen (including the app sidebar), unlike a CSS-only overlay.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(fullscreenElement() === canvasRef.current);
    const target: EventTarget = document;
    target.addEventListener("fullscreenchange", onChange);
    target.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      target.removeEventListener("fullscreenchange", onChange);
      target.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);
  // Set right before we force-exit fullscreen to open the node detail Drawer,
  // so it can be put back once the parent tells us that Drawer has closed.
  const wasFullscreenRef = useRef(false);
  useImperativeHandle(ref, () => ({
    restoreFullscreen: () => {
      if (wasFullscreenRef.current && canvasRef.current) requestFullscreen(canvasRef.current);
      wasFullscreenRef.current = false;
    },
  }), []);

  // The centred title only drops below the toolbar when they would actually overlap.
  const titleRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [titleClash, setTitleClash] = useState(false);
  useEffect(() => {
    const title = titleRef.current;
    const toolbar = toolbarRef.current;
    const canvas = canvasRef.current;
    if (!isFullscreen || !title || !toolbar || !canvas) return;
    const check = () =>
      setTitleClash(title.getBoundingClientRect().right + TITLE_GAP > toolbar.getBoundingClientRect().left);
    const observer = new ResizeObserver(check);
    for (const el of [title, toolbar, canvas]) observer.observe(el);
    return () => observer.disconnect();
  }, [isFullscreen, name]);

  const toggleFullscreen = useCallback(() => {
    if (fullscreenElement()) {
      exitFullscreen();
    } else if (canvasRef.current) {
      requestFullscreen(canvasRef.current);
    }
  }, []);

  // Lets the canvas toolbar swap Findings ↔ Solution without leaving
  // fullscreen — unless there's no solution to show, in which case we leave
  // fullscreen so the "unavailable" notice above the canvas becomes visible.
  const handleToggleView = useCallback(() => {
    if (!onToggleView) return;
    if (!solved && !solutionAvailable) exitFullscreen();
    onToggleView();
  }, [onToggleView, solved, solutionAvailable]);

  const highlightNodes = useMemo(() => new Set(highlight?.nodeIds), [highlight]);
  const highlightEdges = useMemo(() => new Set(highlight?.edgeIds), [highlight]);

  // Re-fit whenever the (already dagre-positioned) nodes change or fullscreen
  // is toggled. A single rAF is enough: `layoutedNodes`/`built` are derived
  // during render (see above and the reset block below), so by the time this
  // effect runs the DOM already reflects the final layout in a single commit.
  useEffect(() => {
    const raf = requestAnimationFrame(() =>
      highlightNodes.size > 0
        ? fitView({ nodes: [...highlightNodes].map((id) => ({ id })), ...ROUTE_FIT_OPTIONS, duration: fitDuration() })
        : fitView({ ...FIT_OPTIONS, duration: fitDuration() }),
    );
    return () => cancelAnimationFrame(raf);
  }, [layoutedNodes, isFullscreen, highlightNodes, fitView]);

  const hasHighlight = highlight != null;
  useEffect(() => {
    if (!hasHighlight || !onClearHighlight) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      onClearHighlight();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hasHighlight, onClearHighlight]);

  // Reset the canvas whenever the source graph changes (e.g. Findings ↔ Solution).
  // Done during render via the "adjust state on prop change" pattern rather than
  // an effect, so there is no extra cascading commit.
  const [prevBuilt, setPrevBuilt] = useState(built);
  if (prevBuilt !== built) {
    setPrevBuilt(built);
    setRfNodes(layoutedNodes);
    setRfEdges(built.edges);
    setPlayback(null);
  }

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlayback(null);
  }, []);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const primaryRoute = useMemo<PlayedRoute>(
    () => ({ nodeIds: built.attackNodeIds, edgeIds: built.attackEdgeIds, label: primaryRouteId(attacks) }),
    [built.attackNodeIds, built.attackEdgeIds, attacks],
  );

  const playRoute: PlayedRoute = highlight ?? primaryRoute;

  const play = useCallback(() => {
    if (playRoute.nodeIds.length === 0) return;
    if (timer.current) clearInterval(timer.current);
    const run = ++playRuns.current;
    setPlayback({ route: playRoute, step: 0, run });
    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      if (i >= playRoute.nodeIds.length) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        window.setTimeout(() => setPlayback((p) => (p?.run === run ? null : p)), 1600);
        return;
      }
      setPlayback((p) => (p?.run === run ? { ...p, step: i } : p));
    }, 760);
  }, [playRoute]);

  const isPlaying = playback !== null;
  const frame = useMemo(
    () => (playback ? playbackFrame(playback.route, playback.step, rfEdges) : null),
    [playback, rfEdges],
  );
  const playedNodes = useMemo(() => new Set(playback?.route.nodeIds), [playback?.route]);
  const shownRoute = playback?.route ?? highlight;
  // A selection made mid-run only takes over once the run ends.
  const nextRoute = playback && highlight && highlight.label !== playback.route.label ? highlight : null;

  // Overlay animation classes without disturbing the (draggable) base positions.
  const renderNodes = useMemo(() => {
    if (!frame) {
      if (!highlight || isolated) return rfNodes;
      return rfNodes.map((n) => ({ ...n, className: highlightNodes.has(n.id) ? "ch-hl" : "ch-dim" }));
    }
    return rfNodes.map((n) => {
      const className = n.id === frame.currentNode ? "ch-current" : frame.liveNodes.has(n.id) ? "ch-live" : playedNodes.has(n.id) ? "" : "ch-dim";
      return { ...n, className };
    });
  }, [frame, playedNodes, rfNodes, highlight, isolated, highlightNodes]);

  const renderEdges = useMemo(() => {
    if (!frame) {
      // A single-node finding has no hops, yet every edge around it must fade.
      if (!highlight || isolated) return rfEdges;
      return rfEdges.map((e) => {
        const lit = highlightEdges.has(e.id);
        return lit
          ? { ...e, className: "ch-edge-hl", zIndex: 5 }
          : { ...e, className: "ch-dim", data: e.data && { ...e.data, dimmed: true } };
      });
    }
    return rfEdges.map((e) => {
      const className = frame.currentEdges.has(e.id) ? "ch-edge-current" : frame.liveEdges.has(e.id) ? "ch-edge-live" : "ch-dim";
      return { ...e, className };
    });
  }, [frame, rfEdges, highlight, isolated, highlightEdges]);

  const download = useCallback(() => {
    // Scope the DOM lookups to this graph's own wrapper so a second graph elsewhere
    // on the page can never be exported by mistake.
    const canvas = canvasRef.current;
    const viewport = canvas?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!canvas || !viewport) return;
    const bounds = getNodesBounds(getNodes());
    const w = 1800;
    const h = 1000;
    const vp = getViewportForBounds(bounds, w, h, 0, MAX_ZOOM, 0.12);
    // `cyber.bg` is a `var(--colorBackground)` reference — html-to-image needs a
    // resolved literal for its rasterised backgroundColor, so read the canvas
    // wrapper's actual computed (theme-resolved) background instead.
    const resolvedBg = getComputedStyle(canvas).backgroundColor;
    void toPng(viewport, {
      backgroundColor: resolvedBg,
      width: w,
      height: h,
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
    }).then((dataUrl) => {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "agenthound-capability-graph.png";
      a.click();
    });
  }, [getNodes]);

  const canPlay = !solved && !pendingRoute && playRoute.nodeIds.length > 0;

  return (
    <div
      ref={canvasRef}
      data-ch-canvas
      data-ch-pending={pendingRoute ? "" : undefined}
      aria-busy={pendingRoute ? true : undefined}
      style={{
        height: isFullscreen ? "100vh" : CANVAS_H,
        width: "100%",
        background: cyber.bg,
        borderRadius: isFullscreen ? 0 : 16,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <style>{CYBER_CSS}</style>
      {pendingRoute && (
        <div style={pendingOverlay}>
          <div style={pendingBox} data-testid="pending-route">
            <Spinner size={18} color={cyber.textPrimary} aria-hidden />
            {labels.loadingIsolatedRoute(pendingRoute)}
          </div>
        </div>
      )}
      <SeverityPathContext.Provider value={severityPath}>
      <ReactFlow
        nodes={renderNodes}
        edges={renderEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          const data = (node as CyberNode).data;
          if (!data?.gnode) return;
          // The node detail Drawer portals to document.body, outside the native
          // fullscreen element, so it would stay invisible if left open here.
          if (isFullscreen) {
            wasFullscreenRef.current = true;
            exitFullscreen();
          }
          onNodeClick(data.gnode);
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={FIT_OPTIONS}
        minZoom={minZoom}
        maxZoom={MAX_ZOOM}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.4} color={cyber.grid} />
        <Controls showInteractive={false} showFitView={false} className="ch-controls">
          <ControlButton onClick={toggleFullscreen} title={isFullscreen ? labels.exitFullscreen : labels.fullscreen}>
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3v4a2 2 0 0 1-2 2H3M15 3v4a2 2 0 0 0 2 2h4M9 21v-4a2 2 0 0 0-2-2H3M15 21v-4a2 2 0 0 1 2-2h4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" />
              </svg>
            )}
          </ControlButton>
        </Controls>

        {isFullscreen && name && (
          <Panel position="top-center" style={{ marginTop: titleClash ? TOOLBAR_CLEARANCE : undefined, transition: "margin-top .2s ease" }}>
            <div ref={titleRef} style={fullscreenTitleBox} title={name} data-testid="fullscreen-title">
              {name}
            </div>
          </Panel>
        )}

        <Panel position="top-right">
          <div ref={toolbarRef} style={{ display: "flex", gap: 8 }} data-testid="graph-toolbar">
            {canPlay && (
              isPlaying ? (
                <ToolbarButton onClick={stop} label={labels.stop} accent={cyber.danger} glyph="◼" />
              ) : (
                <ToolbarButton onClick={play} label={highlight ? labels.playRoute(highlight.label) : labels.playAttack} accent={cyber.danger} glyph="▶" />
              )
            )}
            {!solved && highlight && onToggleIsolated && (
              <ToolbarButton
                onClick={onToggleIsolated}
                label={isolated ? labels.showInContext : isolateFailed ? labels.retryIsolate : isolating ? labels.isolatingRoute : labels.isolateRoute}
                glyph={isolated ? "⊞" : isolateFailed ? "↻" : "⊡"}
              />
            )}
            {isFullscreen && onToggleView && (
              <ToolbarButton
                onClick={handleToggleView}
                label={solved ? labels.viewFindings : labels.viewSolution}
                glyph="⇄"
              />
            )}
            <ToolbarButton onClick={() => fitView({ ...FIT_OPTIONS, duration: fitDuration() })} label={labels.fit} glyph="⤢" />
            <ToolbarButton onClick={download} label={labels.download} glyph="↓" />
          </div>
        </Panel>

        {shownRoute && (
          <Panel position="bottom-center">
            <div style={highlightBox} role="status">
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={legendHeading}>{isPlaying ? labels.playingRoute : isolated ? labels.isolatedRoute : labels.highlightedRoute}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={highlightChip}>{shownRoute.label}</span>
                  {shownRoute.summary && (
                    <span style={highlightSummary} title={shownRoute.summary}>{shownRoute.summary}</span>
                  )}
                </span>
                {nextRoute && <span style={highlightSummary}>{labels.nextRoute(nextRoute.label)}</span>}
                {isolateFailed && <span style={{ ...highlightSummary, color: cyber.danger }}>{labels.isolateError}</span>}
              </div>
              {!isPlaying && onClearHighlight && (
                <ToolbarButton onClick={onClearHighlight} label={labels.clearHighlight} glyph="✕" />
              )}
            </div>
          </Panel>
        )}

        <Panel position="top-left">
          <div style={legendBox}>
            {solved ? (
              <>
                {legendState.hasBlocked && <LegendRow color={cyber.protected} text={labels.legendBlocked} dashed icon="lock" />}
                {legendState.hasMitigated && <LegendRow color={cyber.mitigated} text={labels.legendMitigated} icon="shield" />}
                {legendState.hasSafe && <LegendRow color={cyber.neutral} text={labels.legendSafe} />}
              </>
            ) : (
              <>
                {legendState.hasPathRows && (
                  <div style={legendHeading}>{labels.legendPathSeverity}</div>
                )}
                {legendState.hasPrimaryRoute && (
                  <LegendRow color={severityPath.critical.color} glowColor={severityPath.critical.glow} text={labels.legendPrimaryRoute} dashed glow />
                )}
                {legendState.severities.has("critical") && (
                  <LegendRow color={severityPath.critical.color} text={legendState.hasPrimaryRoute ? labels.legendCritical : labels.legendCriticalOnly} />
                )}
                {legendState.severities.has("high") && <LegendRow color={severityPath.high.color} text={labels.legendHigh} />}
                {legendState.severities.has("medium") && <LegendRow color={severityPath.medium.color} text={labels.legendMedium} />}
                {legendState.severities.has("low") && <LegendRow color={severityPath.low.color} text={labels.legendLow} />}
                {legendState.severities.has("info") && <LegendRow color={severityPath.info.color} text={labels.legendInfo} />}
                {legendState.hasSafe && <LegendRow color={cyber.neutral} text={labels.legendSafe} />}
              </>
            )}
            {!solved && legendState.hasNodeFinding && (
              <>
                {legendState.hasPathRows && <div style={legendDivider} />}
                <div style={legendHeading}>{labels.legendNodeFindings}</div>
                <div data-testid="legend-node-finding" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: cyber.textSecondary }}>
                  <span style={{ display: "inline-flex", borderRadius: 999, border: `1px solid ${cyber.gridStrong}`, zoom: LEGEND_SAMPLE_ZOOM }}>
                    <Tag type="inactive" small>{labels.legendNodeFindingSample}</Tag>
                  </span>
                  {labels.legendNodeFinding}
                </div>
              </>
            )}
            {presentTypes.length > 0 && (
              <>
                <div style={legendDivider} />
                <div style={legendHeading}>{labels.legendNodeTypes}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxWidth: 240 }}>
                  {presentTypes.map((t) => (
                    <NodeTypeChip key={t} type={t} label={labels.nodeTypeLabel[t]} />
                  ))}
                </div>
              </>
            )}
          </div>
        </Panel>
      </ReactFlow>
      </SeverityPathContext.Provider>
    </div>
  );
});

function ToolbarButton({ onClick, label, glyph, accent }: { onClick: () => void; label: string; glyph: string; accent?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 30,
        padding: "0 12px",
        borderRadius: 8,
        border: `1px solid ${accent ?? cyber.laneBorder}`,
        background: accent ? cyber.dangerSoft : cyber.faintOverlay,
        color: accent ?? cyber.textPrimary,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        backdropFilter: "blur(6px)",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 11 }}>{glyph}</span>
      {label}
    </button>
  );
}

const legendBox: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "10px 12px",
  borderRadius: 10,
  background: cyber.bgPanel,
  border: `1px solid ${cyber.laneBorder}`,
  backdropFilter: "blur(6px)",
};

const fullscreenTitleBox: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  background: cyber.bgPanel,
  border: `1px solid ${cyber.laneBorder}`,
  backdropFilter: "blur(6px)",
  fontSize: 20,
  fontWeight: 600,
  color: cyber.textPrimary,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "40vw",
};

const pendingOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
};

const pendingBox: React.CSSProperties = {
  ...fullscreenTitleBox,
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: 14,
};

const highlightBox: React.CSSProperties = {
  ...legendBox,
  flexDirection: "row",
  alignItems: "center",
  gap: 16,
  maxWidth: "min(720px, 80vw)",
};

const highlightChip: React.CSSProperties = {
  padding: "1px 7px",
  borderRadius: 999,
  border: `1px solid ${cyber.textPrimary}`,
  color: cyber.textPrimary,
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: "nowrap",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

const highlightSummary: React.CSSProperties = {
  fontSize: 12,
  color: cyber.textSecondary,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const legendHeading: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  color: cyber.textMuted,
  marginBottom: 2,
};

const legendDivider: React.CSSProperties = {
  height: 1,
  background: cyber.laneBorder,
  margin: "3px 0 1px",
};

// Reading order for the node-type legend (control folds into edges, so it is
// excluded — matching how the graph itself omits control nodes).
const NODE_TYPE_ORDER: Exclude<NodeType, "control">[] = ["input", "agent", "memory", "tool", "data", "output"];

function NodeTypeChip({ type, label }: { type: Exclude<NodeType, "control">; label: string }) {
  const { accent, accentRaw } = NODE_STYLE[type];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 7px 2px 4px",
        borderRadius: 999,
        border: `1px solid ${applyAlpha(accentRaw, 0.33)}`,
        background: cyber.faintOverlay,
        fontSize: 10.5,
        color: cyber.textSecondary,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "grid", placeItems: "center", width: 16, height: 16 }}>{GLYPH[type](accent, 14)}</span>
      {label}
    </span>
  );
}

function LegendIcon({ kind, color }: { kind: "lock" | "shield"; color: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: cyber.bg,
        boxShadow: `0 0 0 1px ${color}`,
      }}
    >
      {kind === "lock" ? (
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none">
          <rect x="5" y="11" width="14" height="9" rx="2" fill={color} />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={color} strokeWidth={1.6} fill="none" />
        </svg>
      ) : (
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none">
          <path d="M12 3.5l6.5 2.6v4.4c0 3.9-2.7 6.5-6.5 7.6-3.8-1.1-6.5-3.7-6.5-7.6V6.1z" fill={color} />
        </svg>
      )}
    </span>
  );
}

function LegendRow({ color, text, icon, cut, dashed, glow, glowColor }: { color: string; text: string; icon?: "lock" | "shield"; cut?: boolean; dashed?: boolean; glow?: boolean; glowColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: cyber.textSecondary }}>
      <span
        style={
          dashed
            ? { width: 18, height: 0, borderTop: `2px dashed ${color}`, filter: `drop-shadow(0 0 5px ${color})`, boxShadow: glow ? `0 0 0 2px ${glowColor ?? color}` : undefined }
            : { width: 18, height: 3, borderRadius: 2, background: color, boxShadow: `0 0 8px ${color}` }
        }
      />
      {icon && <LegendIcon kind={icon} color={color} />}
      {cut && <span aria-hidden style={{ fontSize: 12, color, fontWeight: 700 }}>✕</span>}
      {text}
    </div>
  );
}

const CYBER_CSS = `
.ch-node { transition: box-shadow .2s ease, transform .2s ease, opacity .3s ease; }
.react-flow__edge.ch-edge-flow path.react-flow__edge-path,
.react-flow__edge-path.ch-edge-flow { animation: chDash .6s linear infinite; }
@keyframes chDash { to { stroke-dashoffset: -28; } }
.react-flow__node.ch-dim, .react-flow__edge.ch-dim { opacity: .22; }
.react-flow__viewport { transition: opacity .2s ease; }
[data-ch-pending] .react-flow__viewport, [data-ch-pending] .react-flow__panel.bottom.center { opacity: .3; }
.react-flow__node.ch-current .ch-node { transform: scale(1.09); box-shadow: 0 0 0 2px ${cyber.danger}, 0 0 34px 7px ${cyber.dangerGlow} !important; }
.react-flow__node.ch-live .ch-node { box-shadow: 0 0 0 1.5px ${cyber.danger}, 0 0 20px 2px ${cyber.dangerGlow} !important; }
.react-flow__edge.ch-edge-current path.react-flow__edge-path { stroke-width: 3.4 !important; filter: drop-shadow(0 0 6px ${cyber.danger}); }
.react-flow__edge.ch-edge-live path.react-flow__edge-path { stroke-width: 2.8 !important; }
.react-flow__node.ch-hl .ch-node { box-shadow: 0 0 0 2px ${cyber.textPrimary} !important; }
.react-flow__edge.ch-edge-hl path.react-flow__edge-path { stroke-width: 3.6 !important; opacity: 1 !important; }
.ch-controls button { background: ${cyber.surface}; border-bottom: 1px solid ${cyber.laneBorder}; color: ${cyber.textPrimary}; }
.ch-controls button:hover { background: ${cyber.surfaceHover}; }
.ch-controls button svg { fill: ${cyber.textPrimary}; }

/* ---- agent "reactor core" hero node -------------------------------------- */
@property --ch-angle { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
.ch-reactor:hover { transform: translateY(-1px); }
/* breathing outer halo (box-shadow spreads beyond the card) */
.ch-reactor-halo {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  animation: chReactorHalo 2.6s ease-in-out infinite;
}
@keyframes chReactorHalo {
  0%, 100% { box-shadow: 0 0 16px 1px var(--ch-glow); }
  50%      { box-shadow: 0 0 32px 7px var(--ch-glow); }
}
/* rotating conic-gradient border, masked to a 2px frame */
.ch-reactor-ring {
  position: absolute; inset: 0; pointer-events: none; z-index: 0; padding: 2px;
  background: conic-gradient(from var(--ch-angle),
    transparent 0deg, var(--ch-accent) 70deg, #ffffff 118deg,
    var(--ch-accent) 166deg, transparent 250deg, transparent 360deg);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
  animation: chReactorSpin 4.2s linear infinite;
}
@keyframes chReactorSpin { to { --ch-angle: 360deg; } }
@media (prefers-reduced-motion: reduce) {
  .ch-reactor-ring, .ch-reactor-halo { animation: none; }
}

/* ---- padlock tooltip (recommended controls) ------------------------------ */
/* raise the hovered node/label so its tooltip is not covered by later ones */
.react-flow__node:hover { z-index: 50 !important; }
.ch-lock { position: absolute; top: -12px; right: -12px; z-index: 4; }
.ch-lock-tip {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 5;
  min-width: 168px; max-width: 240px; width: max-content;
  padding: 9px 11px; border-radius: 9px;
  background: ${cyber.tooltipBg}; border: 1px solid ${cyber.protectedBorder};
  box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 0 12px ${cyber.protectedGlow};
  opacity: 0; transform: translateY(-4px); pointer-events: none;
  transition: opacity .15s ease, transform .15s ease;
}
.ch-lock:hover .ch-lock-tip { opacity: 1; transform: translateY(0); }
.ch-elabel:hover { z-index: 60 !important; }
.ch-elock { position: relative; pointer-events: auto; }
.ch-elock[role="button"] { cursor: pointer; }
.ch-elock:hover .ch-lock-tip { opacity: 1; transform: translateY(0); }
.ch-elock .ch-lock-tip { right: 50%; transform: translate(50%, -4px); }
.ch-elock:hover .ch-lock-tip { transform: translate(50%, 0); }
.ch-lock-tip-head {
  display: block;
  font-size: 9.5px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase;
  color: ${cyber.protected}; margin-bottom: 6px;
}
.ch-lock-tip-item {
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 11.5px; line-height: 1.35; color: ${cyber.textSecondary};
}
.ch-lock-tip-item + .ch-lock-tip-item { margin-top: 4px; }
.ch-lock-tip-item::before { content: "✓"; color: ${cyber.protected}; font-weight: 700; }
.ch-lock-tip-tag {
  margin-left: auto; padding: 0 5px; border: 1px solid; border-radius: 999px;
  font-size: 8.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  white-space: nowrap; align-self: center;
}
`;

const CyberGraph = forwardRef<CyberGraphHandle, CyberGraphProps>(function CyberGraph(props, ref) {
  return (
    <ReactFlowProvider>
      <Flow {...props} ref={ref} />
    </ReactFlowProvider>
  );
});

export default CyberGraph;
