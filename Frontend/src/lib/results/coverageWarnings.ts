// Text for the coverage warnings a framework upload returns. `message` is
// English only, so the text is built from the structured fields instead.

import type { CoverageWarning, DeclarationRequirement } from "@/lib/api/types";

/** A translator scoped to `results.coverage`. */
export type CoverageT = (key: string, values?: Record<string, string | number>) => string;

const NODE_TYPES = new Set(["agent", "input", "tool", "data_asset", "output", "memory", "control"]);
const ROLES = new Set(["delegate", "reachable", "read", "sent_to", "shared"]);

function joinList(items: string[], locale: string, type: "conjunction" | "disjunction"): string {
  return new Intl.ListFormat(locale, { style: "long", type }).format(items);
}

/** Where the property goes: the role's phrase when it names one, else the
 * node type's. */
function describeNode(req: DeclarationRequirement, t: CoverageT): string {
  if (req.role && ROLES.has(req.role)) return t(`role.${req.role}`);
  return NODE_TYPES.has(req.node_type) ? t(`on.${req.node_type}`) : req.node_type;
}

function describeRequirement(req: DeclarationRequirement, t: CoverageT, locale: string): string {
  return t("requirement", {
    property: req.property,
    values: joinList(req.values.map(String), locale, "disjunction"),
    node: describeNode(req, t),
  });
}

/** What to declare to unlock a `needs_declaration` warning: the requirements
 * of one option joined with "and", the options with "or". */
export function describeDeclare(declare: DeclarationRequirement[][], t: CoverageT, locale: string): string {
  return joinList(
    declare.map((option) => joinList(option.map((req) => describeRequirement(req, t, locale)), locale, "conjunction")),
    locale,
    "disjunction",
  );
}

/** Why an `ignored_property` key was dropped. */
export function describeIgnored(warning: CoverageWarning, t: CoverageT): string {
  const values = { property: warning.properties[0] ?? "", node: warning.node ?? "" };
  return warning.suggestion
    ? t("ignoredSuggestion", { ...values, suggestion: warning.suggestion })
    : t("ignoredOther", values);
}

export interface CoverageGroups {
  notExpressible: string[];
  needsDeclaration: CoverageWarning[];
  ignored: CoverageWarning[];
  /** Distinct rules the format can't check without help. */
  ruleCount: number;
}

export function groupCoverageWarnings(warnings: CoverageWarning[]): CoverageGroups {
  const notExpressible = [...new Set(warnings.filter((w) => w.kind === "not_expressible").flatMap((w) => w.rules))];
  const needsDeclaration = warnings.filter((w) => w.kind === "needs_declaration");
  return {
    notExpressible,
    needsDeclaration,
    ignored: warnings.filter((w) => w.kind === "ignored_property"),
    ruleCount: new Set([...notExpressible, ...needsDeclaration.flatMap((w) => w.rules)]).size,
  };
}
