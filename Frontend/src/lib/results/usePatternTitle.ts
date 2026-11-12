import { useTranslations } from "next-intl";
import { routeSummary, type NodesById } from "@/lib/results/findingDisplay";
import type { Finding } from "@/types/ThreatModel";

export function usePatternTitle(nodesById: NodesById) {
  const t = useTranslations("results");
  return (finding: Finding) => {
    const anchorId = finding.groupAnchor;
    if (!anchorId) return finding.title;
    const key = nodesById.get(anchorId)?.type === "input" ? "findingGroupFrom" : "findingGroupAt";
    return t(key, { title: finding.title, node: routeSummary([anchorId], nodesById) });
  };
}
