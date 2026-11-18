import { Text1, skinVars } from "@telefonica/mistica";
import { routeSummary } from "@/lib/results/findingDisplay";
import type { GraphNode } from "@/types/ThreatModel";

export function FindingId({ id }: { id: string }) {
  return <Text1 regular color={skinVars.colors.textSecondary}>{id}</Text1>;
}

interface FindingRouteProps {
  path: string[];
  nodesById: Map<string, Pick<GraphNode, "label">>;
}

export function FindingRoute({ path, nodesById }: FindingRouteProps) {
  if (path.length === 0) return null;
  return <Text1 regular color={skinVars.colors.textSecondary}>{routeSummary(path, nodesById)}</Text1>;
}
