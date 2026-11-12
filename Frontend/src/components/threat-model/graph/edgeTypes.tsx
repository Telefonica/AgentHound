import { createContext, memo, useContext, useState } from "react";
import { useTranslations } from "next-intl";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";
import { Drawer, Stack, Inline, Boxed, Box, Tag, Text1, skinVars } from "@telefonica/mistica";
import { cyber, SEVERITY_PATH, type PathSeverity } from "@/components/threat-model/graph/cyberGraphTheme";
import SeverityBadge from "@/components/threat-model/SeverityBadge";
import type { ControlInfo } from "@/types/ThreatModel";

// Theme-resolved severity palette, provided once by the graph (see CyberGraph) so
// each edge reads it from context instead of subscribing to the color scheme
// individually.
export const SeverityPathContext = createContext<Record<PathSeverity, { color: string; glow: string }>>(SEVERITY_PATH);
import type { CyberEdgeData, CyberEdge, EffectLabels } from "@/components/threat-model/graph/toReactFlow";
import { ControlTipItem } from "@/components/threat-model/graph/nodeTypes";
import { formatSnakeCase } from "@/lib/format";

/** Full detail for one applied control: name/effect (as in the hover tooltip)
 * plus its catalog category and the findings it actually breaks — the "why"
 * that doesn't fit in the compact hover tooltip. Opened by clicking the padlock. */
function ControlDetailRow({ control, effectLabels }: { control: ControlInfo; effectLabels: EffectLabels }) {
  const tSeverity = useTranslations("overview.severity");
  const tag =
    control.effect === "total" ? { text: effectLabels.total, color: cyber.protected }
    : control.effect === "partial" ? { text: effectLabels.partial, color: cyber.mitigated }
    : null;
  return (
    <Boxed>
      <Box padding={12}>
        <Stack space={8}>
          <Inline space={8} alignItems="center">
            <Text1 medium>{control.name}</Text1>
            {tag && (
              <Tag small backgroundColor={tag.color} textColor={cyber.bg}>
                {tag.text}
              </Tag>
            )}
          </Inline>
          {control.category && <Tag type="inactive" small>{formatSnakeCase(control.category)}</Tag>}
          {control.findings && control.findings.length > 0 && (
            <Stack space={4}>
              {control.findings.map((f) => (
                <Inline key={f.ruleId} space={8} alignItems="center" wrap verticalSpace={4}>
                  <Tag type="error" small>{f.ruleId}</Tag>
                  <SeverityBadge severity={f.severity} small>{tSeverity(f.severity)}</SeverityBadge>
                  <Text1 regular color={skinVars.colors.textSecondary}>{f.title}</Text1>
                </Inline>
              ))}
            </Stack>
          )}
        </Stack>
      </Box>
    </Boxed>
  );
}

function ControlDetailDrawer({
  controls,
  effectLabels,
  title,
  onClose,
}: {
  controls: ControlInfo[];
  effectLabels: EffectLabels;
  title: string;
  onClose: () => void;
}) {
  return (
    <Drawer title={title} onClose={onClose} onDismiss={onClose} width={420}>
      <Stack space={8}>
        {controls.map((c) => (
          <ControlDetailRow key={`${c.name}:${c.effect}`} control={c} effectLabels={effectLabels} />
        ))}
      </Stack>
    </Drawer>
  );
}

/** Resolve stroke + glow for an edge from its variant and (for findings) severity. */
function edgeColors(
  data: CyberEdgeData | undefined,
  severityPath: Record<PathSeverity, { color: string; glow: string }>,
): { stroke: string; glow: string } {
  const variant = data?.variant ?? "neutral";
  if (variant === "danger") return { stroke: severityPath.critical.color, glow: severityPath.critical.glow };
  if (variant === "finding") {
    const sev = severityPath[data?.severity ?? "info"];
    return { stroke: sev.color, glow: sev.glow };
  }
  if (variant === "blocked") return { stroke: cyber.protected, glow: cyber.protectedGlow };
  if (variant === "mitigated") return { stroke: cyber.mitigated, glow: cyber.mitigatedGlow };
  if (variant === "neutralized") return { stroke: cyber.protected, glow: "transparent" };
  return { stroke: cyber.neutral, glow: "transparent" };
}

// Dark opaque disc (hides the edge line passing behind it) + a large, coloured
// glyph with a matching neon ring, so the meaning reads at a glance and never
// blends into the same-coloured edge.
function WarnBadge() {
  return (
    <span style={badgeBox(cyber.danger, cyber.dangerGlow)}>
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <path d="M12 4l9.5 16H2.5z" fill={cyber.danger} stroke={cyber.bg} strokeWidth={1} strokeLinejoin="round" />
        <path d="M12 10.2v4" stroke={cyber.bg} strokeWidth={2.3} strokeLinecap="round" />
        <circle cx="12" cy="17" r="1.15" fill={cyber.bg} />
      </svg>
    </span>
  );
}

function LockChip() {
  return (
    <span style={badgeBox(cyber.protected, cyber.protectedGlow)}>
      <svg width={21} height={21} viewBox="0 0 24 24" fill="none">
        <rect x="5" y="11" width="14" height="9" rx="2" fill={cyber.protected} />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={cyber.protected} strokeWidth={2.4} fill="none" />
        <circle cx="12" cy="15.5" r="1.4" fill={cyber.bg} />
      </svg>
    </span>
  );
}

// Mitigated (partial-effect) hop: a control weakens it but the route survives —
// gold shield, mirroring the node badge's partial glyph.
function ShieldChip() {
  return (
    <span style={badgeBox(cyber.mitigated, cyber.mitigatedGlow)}>
      <svg width={21} height={21} viewBox="0 0 24 24" fill="none">
        <path d="M12 3.5l6.5 2.6v4.4c0 3.9-2.7 6.5-6.5 7.6-3.8-1.1-6.5-3.7-6.5-7.6V6.1z" fill={cyber.mitigated} />
        <path d="M9.2 12.2l2 2 3.6-4" stroke={cyber.bg} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function badgeBox(ring: string, glow: string): React.CSSProperties {
  return {
    display: "grid",
    placeItems: "center",
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: cyber.bg,
    boxShadow: `0 0 0 2px ${ring}, 0 0 18px 3px ${glow}`,
    pointerEvents: "none",
  };
}

// Deterministic per-edge curvature so edges sharing a source/target fan out
// instead of stacking into straight, overlapping lines. Higher base curvature
// bows every hop; the id-derived jitter separates parallel ones.
function edgeCurvature(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return 0.4 + (h % 35) / 100; // 0.40 – 0.74
}

// Route id pill shown on the primary FH-001 route, echoing the reference report's
// edge label so the critical path is identifiable end to end.
function RouteChip({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        padding: "1px 7px",
        borderRadius: 999,
        background: cyber.bg,
        border: `1px solid ${color}`,
        color,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {label}
    </span>
  );
}

const CyberEdgeView = memo((props: EdgeProps<CyberEdge>) => {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data } = props;
  const variant = data?.variant ?? "neutral";
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: edgeCurvature(id) });
  const severityPath = useContext(SeverityPathContext);
  const { stroke: color } = edgeColors(data, severityPath);
  const isDanger = variant === "danger";
  const isFinding = variant === "finding";
  const isBlocked = variant === "blocked";
  const isMitigated = variant === "mitigated";
  const isNeutralized = variant === "neutralized";
  const pathLabel = data?.pathLabel;
  const controls = data?.controls ?? [];
  const controlsLabel = data?.controlsLabel ?? "";
  const effectLabels = data?.effectLabels ?? { total: "", partial: "" };
  const hasControls = controls.length > 0;

  // Hover still shows the compact tooltip (as before); a click opens a drawer
  // with the full detail (category + findings broken) for every control on this hop.
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <>
      {/* soft glow underlay for the highlighted variants */}
      {(isDanger || isBlocked || isMitigated) && (
        <path d={path} fill="none" stroke={color} strokeWidth={7} strokeOpacity={0.18} strokeLinecap="round" style={{ filter: "blur(1px)" }} />
      )}
      <BaseEdge
        path={path}
        markerEnd={isBlocked ? undefined : markerEnd}
        className={isDanger ? "ch-edge-flow" : undefined}
        style={{
          stroke: color,
          strokeWidth: isDanger ? 2.6 : isFinding ? 2.2 : isMitigated ? 2.2 : isBlocked ? 1.8 : isNeutralized ? 1.8 : 1.9,
          strokeDasharray: isDanger ? "8 6" : isBlocked ? "3 5" : undefined,
          opacity: isBlocked ? 0.85 : isNeutralized ? 0.5 : variant === "neutral" ? 0.9 : 1,
        }}
      />
      {(isDanger || isBlocked || isMitigated) && (
        <EdgeLabelRenderer>
          <div
            className="ch-elabel"
            style={{
              position: "absolute",
              zIndex: 10,
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              opacity: data?.dimmed ? 0.22 : 1,
              transition: "opacity .3s ease",
            }}
          >
            {isDanger ? (
              <WarnBadge />
            ) : (
              <span
                className="ch-elock"
                role={hasControls ? "button" : undefined}
                tabIndex={hasControls ? 0 : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasControls) setDetailOpen(true);
                }}
                onKeyDown={(e) => {
                  if (!hasControls) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDetailOpen(true);
                  }
                }}
              >
                {isBlocked ? <LockChip /> : <ShieldChip />}
                {hasControls && (
                  <span className="ch-lock-tip" role="tooltip">
                    <span className="ch-lock-tip-head">{controlsLabel}</span>
                    {controls.map((c) => (
                      <ControlTipItem key={`${c.name}:${c.effect}`} control={c} labels={effectLabels} />
                    ))}
                  </span>
                )}
              </span>
            )}
            {pathLabel && <RouteChip label={pathLabel} color={color} />}
          </div>
        </EdgeLabelRenderer>
      )}
      {detailOpen && hasControls && (
        <ControlDetailDrawer
          controls={controls}
          effectLabels={effectLabels}
          title={controlsLabel}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  );
});
CyberEdgeView.displayName = "CyberEdgeView";

export const edgeTypes: EdgeTypes = { cyber: CyberEdgeView };
