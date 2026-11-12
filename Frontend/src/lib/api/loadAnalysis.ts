/**
 * Composition helpers that assemble a full {@link AnalysisResult} from the raw
 * endpoint calls. Shared by the wizard (after running an analysis) and the
 * standalone result view (opening a stored analysis from the overview) so both
 * build the Findings + Proposed Solution the same way.
 */

import {
  getAnalysis,
  getControlRecommendations,
  getFindings,
  getGraph,
  simulateControls,
} from "./agentHound";
import {
  toAnalysisResult,
  toSolutionResult,
  type AnalysisResult,
  type SolutionResult,
} from "./adapters";
import type { ControlRecommendation } from "./types";
import { logger } from "@/lib/logger";

/**
 * Load the Proposed Solution for an analysis: fetch the ranked control
 * recommendations, then simulate applying all of them to get the before/after
 * risk and the mitigated graph. Callers that already have the recommendations
 * in flight can pass them in to skip the extra round-trip. Returns null on
 * failure so the Findings tab stays usable even if Phase 2 is unavailable.
 */
export async function loadSolution(
  analysisId: string,
  base: AnalysisResult,
  prefetched?: ControlRecommendation[],
): Promise<SolutionResult | null> {
  try {
    const recommendations = prefetched ?? (await getControlRecommendations(analysisId)).recommendations;
    const sim = await simulateControls(
      analysisId,
      recommendations.map((r) => ({ control_id: r.control_id, target_node_id: r.target_node_id })),
    );
    return toSolutionResult(sim, recommendations, base);
  } catch (err) {
    logger.error("Control simulation failed", err);
    return null;
  }
}

/**
 * Build the full results view for a stored, already-analyzed analysis. Every
 * request that only needs the id starts at once, leaving just the control
 * simulation (which needs the recommendations) on a second hop. Throws if the id
 * is not a stored analysis.
 */
export async function loadAnalysisResult(analysisId: string): Promise<AnalysisResult> {
  const [item, graph, findings, recommendations] = await Promise.all([
    getAnalysis(analysisId),
    getGraph(analysisId),
    getFindings(analysisId),
    // Phase 2 may be unavailable; its failure must not sink the Findings tab.
    getControlRecommendations(analysisId).then(
      (r) => r.recommendations,
      (err) => {
        logger.error("Control recommendations failed", err);
        return null;
      },
    ),
  ]);
  const base = toAnalysisResult(
    {
      analysis_id: item.analysis_id,
      status: "analyzed",
      name: item.name,
      source_framework: item.source_framework,
      summary: item.summary,
      warnings: item.warnings,
    },
    graph,
    findings,
  );
  return {
    ...base,
    solution: recommendations ? await loadSolution(analysisId, base, recommendations) : null,
  };
}
