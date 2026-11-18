import {
  IconCheckFilled,
  IconEqualFilled,
  IconRankHighFilled,
  IconRankHighestFilled,
  IconRankLowFilled,
} from "@telefonica/mistica";
import type { IconProps } from "@telefonica/mistica";
import type { ReactElement } from "react";
import { palette } from "./cyberSkin";

export type Severity = "critical" | "high" | "medium" | "low" | "none";

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };

export interface SeverityStyle {
  /** Tag pill background — fixed, self-contained contrast with `text`, independent of page theme. */
  background: string;
  /** Tag pill text/icon color — pairs with `background` only, never used on the page background directly. */
  text: string;
  /** Standalone text color (KPI numbers, counters) on a light page background. */
  accentLight: string;
  /** Standalone text color (KPI numbers, counters) on a dark page background. */
  accentDark: string;
  Icon: (props: IconProps) => ReactElement;
}

// Colors and icons mirror the "Severity Tag" component from the Cybersecurity
// Figma library (node 15:730) so severity indicators stay consistent across projects.
// `accentLight`/`accentDark` are separate from the pill's `background`/`text` because a
// standalone number sits directly on the page/card background, which flips with the theme —
// the pill colors don't need to change since background+text is always a self-contained pair.
export const SEVERITY_STYLES: Record<Severity, SeverityStyle> = {
  critical: {
    background: palette.criticalRed,
    text: palette.red90,
    accentLight: palette.red50,
    accentDark: palette.red30,
    Icon: IconRankHighestFilled,
  },
  high: {
    background: palette.orange,
    text: palette.orange90,
    accentLight: palette.orange60,
    accentDark: palette.orange,
    Icon: IconRankHighFilled,
  },
  medium: {
    background: palette.yellow,
    text: palette.yellow80,
    accentLight: palette.yellow60,
    accentDark: palette.yellow60,
    Icon: IconEqualFilled,
  },
  low: {
    background: palette.purple10,
    text: palette.purple70,
    accentLight: palette.purple70,
    accentDark: palette.purple40,
    Icon: IconRankLowFilled,
  },
  none: {
    background: palette.green10,
    text: palette.green70,
    accentLight: palette.green70,
    accentDark: palette.green,
    Icon: IconCheckFilled,
  },
};
