import { memo } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { applyAlpha, ScreenReaderOnly } from "@telefonica/mistica";
import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import SeverityBadge from "@/components/threat-model/SeverityBadge";
import type { NodeType } from "@/types/ThreatModel";
import {
  cyber,
  DATA_SAFE_ACCENT,
  DATA_SAFE_ACCENT_RAW,
  DATA_SAFE_GLOW,
  NODE_STYLE,
  nodeSize,
} from "@/components/threat-model/graph/cyberGraphTheme";
import { type CyberNode, type NodeFindingMark } from "@/components/threat-model/graph/toReactFlow";
import type { ControlInfo } from "@/types/ThreatModel";

/* ---- representative glyphs (inline SVG, stroke = neon accent) -------------- */

// Returns a render fn (color -> svg element), not a component, to keep node
// glyphs as plain inline SVG the card composes.
const svg = (children: React.ReactNode) =>
  // eslint-disable-next-line react/display-name -- render helper, not a component
  (color: string, size = 34) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );

export const GLYPH: Record<NodeType, (color: string, size?: number) => React.ReactElement> = {
  // entry point / untrusted input — globe
  input: svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></>),
  // agent — robot head
  agent: svg(<><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M12 8V4M8 4h8" /><circle cx="9" cy="13" r="1.2" /><circle cx="15" cy="13" r="1.2" /></>),
  // memory — chip
  memory: svg(<><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" /></>),
  // tool — wrench
  tool: svg(<><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8 7.2 20l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.3-.6-.6-2.3z" /></>),
  // data — database cylinder
  data: svg(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>),
  // control — shield (unused: controls fold into protected edges)
  control: svg(<><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></>),
  // output — paper plane / external send
  output: svg(<><path d="M21 3L11 13M21 3l-6.5 18-4-8-8-4L21 3z" /></>),
};

/** One control line in the padlock hover tooltip: its name plus a colour-coded
 * effect tag (Blocks / Mitigates), so the control that cuts the route reads
 * apart from the ones that only reinforce it. Kept deliberately compact — the
 * full detail (category, findings broken) lives in the click-triggered drawer. */
export function ControlTipItem({ control, labels }: { control: ControlInfo; labels: { total: string; partial: string } }) {
  const tag =
    control.effect === "total" ? { text: labels.total, color: cyber.protected }
    : control.effect === "partial" ? { text: labels.partial, color: cyber.mitigated }
    : null;
  return (
    <span className="ch-lock-tip-item">
      {control.name}
      {tag && <span className="ch-lock-tip-tag" style={{ color: tag.color, borderColor: tag.color }}>{tag.text}</span>}
    </span>
  );
}

export function NodeFindingCorner({ mark }: { mark: NodeFindingMark }) {
  const t = useTranslations("results");
  const format = useFormatter();
  const score = format.number(mark.score, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const description = t("nodeFindings", { count: mark.count, score });
  return (
    <span title={description} style={{ position: "absolute", top: -12, left: 14, zIndex: 3 }}>
      <span aria-hidden style={{ display: "inline-flex" }}>
        <SeverityBadge severity={mark.severity} small withIcon dataAttributes={{ testid: "node-finding-badge", severity: mark.severity }}>
          {mark.count > 1 ? `${score} · +${mark.count - 1}` : score}
        </SeverityBadge>
      </span>
      <ScreenReaderOnly>
        <span>{description}</span>
      </ScreenReaderOnly>
    </span>
  );
}

/* ---- node ------------------------------------------------------------------ */

export function accentFor(node: CyberNode["data"]) {
  const { gnode } = node;
  const base = NODE_STYLE[gnode.type];
  if (gnode.type === "data") {
    const props = gnode.properties ?? {};
    const risky = gnode.risk === "high" || props.sensitivity === "high" || props.sensitivity === "critical" || props.contains_pii === true;
    return risky
      ? { accent: base.accent, accentRaw: base.accentRaw, glow: base.glow }
      : { accent: DATA_SAFE_ACCENT, accentRaw: DATA_SAFE_ACCENT_RAW, glow: DATA_SAFE_GLOW };
  }
  return { accent: base.accent, accentRaw: base.accentRaw, glow: base.glow };
}

const CyberNodeView = memo(({ data, selected }: NodeProps<CyberNode>) => {
  const { gnode } = data;
  const style = NODE_STYLE[gnode.type];
  const { accent, accentRaw, glow } = accentFor(data);
  const label = gnode.label.replace(/\n/g, " ");

  // The agent is the hero "reactor core": larger, with a rotating conic-gradient
  // border, a breathing halo and an "online" pulse — so the eye lands on it first.
  const isAgent = gnode.type === "agent";
  const { w, h } = nodeSize(gnode.type);
  const iconBox = isAgent ? 68 : 56;

  // Every node keeps its own accent glow, in both the findings and solution
  // views — a shared green/red halo per attacked node was dropped because it
  // camouflaged the node's own colour. "Protected" is conveyed separately by
  // the padlock badge below, not by recolouring the node's halo.
  const ring = `0 0 14px 0 ${glow}`;

  const contentLayer: React.CSSProperties = { position: "relative", zIndex: 1 };

  return (
    <div
      className={`ch-node${isAgent ? " ch-reactor" : ""}`}
      style={{
        width: w,
        // The agent hero sizes to its content; AGENT_H already leaves room for it.
        height: isAgent ? undefined : h,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: isAgent ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        textAlign: isAgent ? "center" : "left",
        gap: isAgent ? 11 : 13,
        padding: isAgent ? "16px 8px" : "12px 15px",
        borderRadius: style.radius,
        border: `1.5px solid ${isAgent ? "transparent" : accent}`,
        background: cyber.cardBg,
        boxShadow: selected ? `0 0 0 2px ${accent}, 0 0 26px 3px ${glow}` : ring,
        color: cyber.textPrimary,
        cursor: "pointer",
        position: "relative",
        transition: "box-shadow .2s ease, transform .2s ease",
        // exposes the accent to the reactor CSS layers (conic border, halo, dot)
        ...(isAgent ? ({ "--ch-accent": accent, "--ch-glow": glow } as React.CSSProperties) : {}),
      }}
    >
      {isAgent && (
        <>
          {/* breathing outer halo + rotating conic-gradient border */}
          <span className="ch-reactor-halo" aria-hidden style={{ borderRadius: style.radius }} />
          <span className="ch-reactor-ring" aria-hidden style={{ borderRadius: style.radius }} />
        </>
      )}
      {data.findingMark && <NodeFindingCorner mark={data.findingMark} />}
      <Handle type="target" position={Position.Left} style={{ background: accent, width: 9, height: 9, border: "none", zIndex: 2 }} />
      <div
        style={{
          ...contentLayer,
          flex: "0 0 auto",
          width: iconBox,
          height: iconBox,
          borderRadius: isAgent ? 18 : 15,
          display: "grid",
          placeItems: "center",
          background: cyber.faintOverlay,
          boxShadow: `inset 0 0 0 1px ${applyAlpha(accentRaw, 0.33)}`,
        }}
      >
        {GLYPH[gnode.type](accent, isAgent ? 42 : 34)}
      </div>
      <div style={{ ...contentLayer, minWidth: 0, maxWidth: "100%", lineHeight: 1.18 }}>
        <div style={{ fontSize: isAgent ? 11 : 10.5, letterSpacing: 1.4, fontWeight: 700, color: accent, opacity: 0.95 }}>
          {isAgent ? `${style.kicker} · CORE` : style.kicker}
        </div>
        <div style={{ fontSize: isAgent ? 16.5 : 15.5, fontWeight: 700, marginTop: isAgent ? 3 : 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}>{label}</div>
        {gnode.sub && <div data-testid="node-sub" title={gnode.sub} style={{ fontSize: 11, color: cyber.textSecondary, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word", maxWidth: "100%" }}>{gnode.sub}</div>}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: accent, width: 9, height: 9, border: "none", zIndex: 2 }} />
    </div>
  );
});
CyberNodeView.displayName = "CyberNodeView";

export const nodeTypes: NodeTypes = { cyber: CyberNodeView };
