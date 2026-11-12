import type { Severity } from "@/lib/severity";
import type { Finding, GraphNode } from "@/types/ThreatModel";

export const FILTER_SEVERITIES = ["critical", "high", "medium", "low"] as const satisfies readonly Severity[];

type NodeLabels = Map<string, Pick<GraphNode, "label">>;

export type FindingSearchIndex = Map<string, string>;

export interface FindingFilter {
  query: string;
  severities: ReadonlySet<Severity>;
}

export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function buildSearchIndex(findings: Finding[], labelById: Map<string, string>, nodesById: NodeLabels): FindingSearchIndex {
  return new Map(
    findings.map((f) => [
      f.id,
      normalizeSearch(
        [
          labelById.get(f.id) ?? f.ruleId,
          f.id,
          f.ruleId,
          f.title,
          f.desc,
          f.category,
          ...f.path.map((id) => nodesById.get(id)?.label ?? id),
          ...(f.owaspAgentic ?? []),
          ...(f.owaspLlm ?? []),
          ...(f.mitre ?? []),
        ].join(" "),
      ),
    ]),
  );
}

export function isFiltering({ query, severities }: FindingFilter): boolean {
  return query.trim() !== "" || severities.size > 0;
}

export function filterFindings(findings: Finding[], filter: FindingFilter, index: FindingSearchIndex): Finding[] {
  if (!isFiltering(filter)) return findings;
  const terms = normalizeSearch(filter.query).split(/\s+/).filter(Boolean);
  return findings.filter((f) => {
    if (filter.severities.size > 0 && !filter.severities.has(f.severity)) return false;
    if (terms.length === 0) return true;
    const text = index.get(f.id) ?? "";
    return terms.every((term) => text.includes(term));
  });
}
