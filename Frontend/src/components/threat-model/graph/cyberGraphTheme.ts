import { useSyncExternalStore } from "react";
import { applyAlpha, skinVars } from "@telefonica/mistica";
import { palette } from "@/lib/cyberSkin";
import { useColorScheme } from "@/contexts/ColorSchemeContext";
import type { NodeType } from "@/types/ThreatModel";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

function subscribeToOsScheme(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(DARK_MEDIA_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getOsIsDark() {
  return typeof window !== "undefined" && window.matchMedia(DARK_MEDIA_QUERY).matches;
}

/**
 * Resolves the app's `colorScheme` ("light" | "dark" | "auto") to a boolean,
 * following the OS preference live when set to "auto" — needed because a
 * couple of the fixed `STATUS` accents (see below) are legible on a dark
 * canvas at their given hex but too pale against a light one, so those two
 * need an actual light-mode-only override rather than a single fixed value.
 */
export function useIsDarkMode(): boolean {
  const { colorScheme } = useColorScheme();
  const osIsDark = useSyncExternalStore(subscribeToOsScheme, getOsIsDark, () => false);
  if (colorScheme === "dark") return true;
  if (colorScheme === "light") return false;
  return osIsDark;
}

// Fixed (non-adaptive) severity/status accents — pulled from the app's own
// Mistica "Cyber" skin palette (`@/lib/cyberSkin`), the same source as the
// `criticalRed`/`orange`/`yellow` used by the severity tags elsewhere in the
// app (see `SEVERITY_STYLES` in `@/lib/severity`). Kept constant across light
// and dark (like `criticalRed` already is in the skin) so the path-severity
// legend reads identically in both modes; `slate` has no existing named token
// in the palette, so it's defined here directly.
const slate = "#58617A";
const STATUS = {
  critical: palette.criticalRed, // #FC6A6D
  high: palette.orange60, // #DA773E
  medium: palette.yellow, // #FBF662
  low: palette.purple70, // #9E2EB1
  info: palette.green, // #43A062 — same hue family as `protected` below
  protected: palette.green, // #43A062
  blocked: slate, // #58617A
  // Partial-effect controls: the hop survives but is weakened. A distinct green
  // keeps it clearly separate from the blocked state without using the yellow
  // family that previously read as residual risk.
  mitigated: "#2FAF7A", // emerald green
} as const;

/**
 * Capability graph palette — chrome (backgrounds, text, panels) is sourced
 * from the app's Mistica "Cyber" skin (`skinVars`) so it follows the app's
 * light/dark toggle automatically; severity/status accents are fixed (see
 * `STATUS` above) so the legend colors stay consistent across themes.
 */
export const cyber = {
  bg: skinVars.colors.background,
  bgPanel: applyAlpha(skinVars.rawColors.backgroundContainer, 0.85),
  // Node card face — a two-stop gradient echoing the skin's container surface.
  cardBg: `linear-gradient(160deg, ${applyAlpha(skinVars.rawColors.backgroundContainer, 0.97)}, ${applyAlpha(skinVars.rawColors.background, 0.97)})`,
  // Flat opaque surface shared by floating chrome (React Flow controls, minimap).
  surface: skinVars.colors.backgroundContainer,
  surfaceHover: skinVars.colors.backgroundContainerHover,
  // Near-opaque surface for tooltips/popovers.
  tooltipBg: applyAlpha(skinVars.rawColors.backgroundContainer, 0.97),
  // Very faint neutral wash for icon boxes / secondary buttons.
  faintOverlay: applyAlpha(skinVars.rawColors.neutralHigh, 0.05),
  // Dim mask outside the minimap viewport.
  overlay: applyAlpha(skinVars.rawColors.neutralHigh, 0.12),
  grid: skinVars.colors.border,
  gridStrong: skinVars.colors.borderHigh,
  laneBorder: skinVars.colors.border,
  textPrimary: skinVars.colors.textPrimary,
  textSecondary: skinVars.colors.textSecondary,
  textMuted: skinVars.colors.neutralMedium,
  // edges / states
  danger: STATUS.critical,
  dangerGlow: applyAlpha(STATUS.critical, 0.55),
  dangerSoft: applyAlpha(STATUS.critical, 0.12),
  protected: STATUS.protected,
  protectedGlow: applyAlpha(STATUS.protected, 0.5),
  protectedBorder: applyAlpha(STATUS.protected, 0.35),
  blocked: STATUS.blocked,
  blockedGlow: applyAlpha(STATUS.blocked, 0.5),
  mitigated: STATUS.mitigated,
  mitigatedGlow: applyAlpha(STATUS.mitigated, 0.5),
  neutral: skinVars.colors.textSecondary,
  edgeDefault: skinVars.colors.border,
} as const;

// Per-severity path colors, mirroring the bhat_agentic_2026 report ("Path
// severity" legend): the primary FH-001 route reads critical-red, lower-severity
// finding paths grade orange → yellow → purple → green, matching the app's
// Mistica "Cyber" skin palette (`STATUS` above).
export type PathSeverity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITY_PATH: Record<PathSeverity, { color: string; glow: string }> = {
  critical: { color: STATUS.critical, glow: applyAlpha(STATUS.critical, 0.55) },
  high: { color: STATUS.high, glow: applyAlpha(STATUS.high, 0.5) },
  medium: { color: STATUS.medium, glow: applyAlpha(STATUS.medium, 0.45) },
  low: { color: STATUS.low, glow: applyAlpha(STATUS.low, 0.45) },
  info: { color: STATUS.info, glow: applyAlpha(STATUS.info, 0.4) },
} as const;

// `medium`'s dark-mode hex (#FBF662) is a very pale yellow — close to
// invisible against a light canvas. `yellow60` is the same hue family, already
// used as the skin's own light-mode "warning" token, so it reads correctly on
// white without drifting from the requested palette.
const MEDIUM_LIGHT = palette.yellow60; // #BEA537

/** `SEVERITY_PATH`, swapping in the light-mode-legible variant of `medium`. */
export function getSeverityPath(isDark: boolean): Record<PathSeverity, { color: string; glow: string }> {
  if (isDark) return SEVERITY_PATH;
  return { ...SEVERITY_PATH, medium: { color: MEDIUM_LIGHT, glow: applyAlpha(MEDIUM_LIGHT, 0.45) } };
}

export interface NodeTypeStyle {
  /** Mistica accent token used for border, icon and glow. */
  accent: string;
  /** The same accent as its `rawColors` counterpart — pass to `applyAlpha()` for a custom-alpha variant instead of string-concatenating a hex suffix onto `accent` (which is a `var()` reference, not a hex string). */
  accentRaw: string;
  /** rgba glow used for the outer box-shadow halo. */
  glow: string;
  /** Short human label shown as the node's kicker (e.g. "AGENT"). */
  kicker: string;
  /** Corner radius, in px — lets each type read as a distinct silhouette. */
  radius: number;
}

// Accent per node type, mapped onto the closest Mistica "Cyber" skin token —
// mirrors the same type→token mapping used for the solution graph's node fills
// (see `nodeFillColor` in `@/lib/threatModelColors`) so both graphs read as one
// system. Data is special-cased at render time: sensitive / PII data uses the
// error accent, otherwise it falls back to the "safe" warning accent below.
export const NODE_STYLE: Record<NodeType, NodeTypeStyle> = {
  input: { accent: skinVars.colors.warningHigh, accentRaw: skinVars.rawColors.warningHigh, glow: applyAlpha(skinVars.rawColors.warningHigh, 0.45), kicker: "ENTRY", radius: 40 },
  agent: { accent: skinVars.colors.brand, accentRaw: skinVars.rawColors.brand, glow: applyAlpha(skinVars.rawColors.brand, 0.5), kicker: "AGENT", radius: 26 },
  memory: { accent: skinVars.colors.promo, accentRaw: skinVars.rawColors.promo, glow: applyAlpha(skinVars.rawColors.promo, 0.45), kicker: "MEMORY", radius: 26 },
  tool: { accent: skinVars.colors.successHigh, accentRaw: skinVars.rawColors.successHigh, glow: applyAlpha(skinVars.rawColors.successHigh, 0.45), kicker: "TOOL", radius: 10 },
  data: { accent: skinVars.colors.errorHigh, accentRaw: skinVars.rawColors.errorHigh, glow: applyAlpha(skinVars.rawColors.errorHigh, 0.45), kicker: "DATA", radius: 18 },
  control: { accent: skinVars.colors.successHigh, accentRaw: skinVars.rawColors.successHigh, glow: applyAlpha(skinVars.rawColors.successHigh, 0.5), kicker: "CONTROL", radius: 40 },
  output: { accent: skinVars.colors.promoHigh, accentRaw: skinVars.rawColors.promoHigh, glow: applyAlpha(skinVars.rawColors.promoHigh, 0.45), kicker: "OUTPUT", radius: 10 },
};

export const DATA_SAFE_ACCENT = skinVars.colors.warningHigh;
export const DATA_SAFE_ACCENT_RAW = skinVars.rawColors.warningHigh;
export const DATA_SAFE_GLOW = applyAlpha(skinVars.rawColors.warningHigh, 0.4);

// Node box size (px). React Flow positions nodes by their top-left corner, so
// toReactFlow offsets the swimlane centre by half of these. NODE_H fits a
// two-line label plus a two-line subtitle (~102px), and nodeTypes renders the
// box at exactly this height so layout and rendering agree.
export const NODE_W = 228;
export const NODE_H = 104;

// The agent is the protagonist of the threat model (the orchestrating "brain"
// every attack path runs through), so it renders larger than the rest — a
// deliberate "reactor core" hero node. The real size is fed to every layout
// path (swimlane centring, lane bands, ELK) so edges stay pinned to its handles
// and neighbours reserve space for it.
export const AGENT_W = 150;
export const AGENT_H = 200;

/** Real box size for a node type — the agent hero is larger than the rest. */
export function nodeSize(type: NodeType): { w: number; h: number } {
  return type === "agent" ? { w: AGENT_W, h: AGENT_H } : { w: NODE_W, h: NODE_H };
}

// Horizontal / vertical scale applied to the backend swimlane layout. Kept
// tighter horizontally (lanes closer) and taller vertically so fitView zooms
// further in and the neon cards read large on stage.
export const SCALE_X = 1.18;
export const SCALE_Y = 1.5;
