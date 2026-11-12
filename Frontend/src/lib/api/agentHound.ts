/**
 * Endpoint functions for the AgentHound backend (spec sections 12.1–12.3).
 *
 * Each returns the raw backend shape; use the mappers in `@/lib/api/adapters`
 * to convert to the camelCase UI types.
 */

import { apiFetch } from "./client";
import type {
  AnalysesListResponse,
  AnalysisListItem,
  AnalyzeRequest,
  AnalyzeResponse,
  BackendGraph,
  CapabilitiesResponse,
  ControlApplication,
  CreateAnalysisResponse,
  DeleteAnalysisResponse,
  FindingDetailResponse,
  FindingsResponse,
  RecommendationsResponse,
  SimulateControlsResponse,
} from "./types";

/** Every capability verb with the rules that check it (`GET /capabilities`). */
export async function getCapabilities(): Promise<CapabilitiesResponse> {
  return apiFetch<CapabilitiesResponse>("/capabilities");
}

/** List stored analyses, most recently uploaded first (`GET /analyses`). */
export async function listAnalyses(): Promise<AnalysesListResponse> {
  return apiFetch<AnalysesListResponse>("/analyses");
}

/** Fetch one stored analysis' name and summary (`GET /analyses/{id}`). Same
 * shape as a row of {@link listAnalyses}, without pulling the whole list. */
export async function getAnalysis(analysisId: string): Promise<AnalysisListItem> {
  return apiFetch<AnalysisListItem>(`/analyses/${encodeURIComponent(analysisId)}`);
}

/** Rename a stored analysis (`PATCH /analyses/{id}`). Returns the same shape as
 * {@link getAnalysis}, with the new (trimmed) name. */
export async function renameAnalysis(
  analysisId: string,
  name: string,
): Promise<AnalysisListItem> {
  return apiFetch<AnalysisListItem>(`/analyses/${encodeURIComponent(analysisId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/** Delete a stored analysis (`DELETE /analyses/{id}`). */
export async function deleteAnalysis(analysisId: string): Promise<DeleteAnalysisResponse> {
  return apiFetch<DeleteAnalysisResponse>(`/analyses/${encodeURIComponent(analysisId)}`, {
    method: "DELETE",
  });
}

/**
 * Submit an architecture YAML for parsing (`POST /analyses`).
 *
 * This is the PARSE stage: the backend parses the YAML into a stored graph but
 * does NOT run the rules yet (the frontend shows the inferred capabilities for
 * editing first, then calls {@link analyze}). It accepts a single file plus an
 * optional framework override and an optional name. When `framework` is omitted
 * the backend auto-detects it; when `name` is provided it overrides the YAML's
 * metadata.name.
 */
export async function createAnalysis(
  file: File,
  { framework, name }: { framework?: string; name?: string } = {},
): Promise<CreateAnalysisResponse> {
  const form = new FormData();
  form.append("file", file);
  if (framework) {
    form.append("framework", framework);
  }
  if (name && name.trim()) {
    form.append("name", name.trim());
  }
  // Do not set Content-Type: the browser adds the multipart boundary itself.
  return apiFetch<CreateAnalysisResponse>("/analyses", { method: "POST", body: form });
}

/** Fetch the normalized graph for an analysis (`GET /analyses/{id}/graph`). */
export async function getGraph(analysisId: string): Promise<BackendGraph> {
  return apiFetch<BackendGraph>(`/analyses/${encodeURIComponent(analysisId)}/graph`);
}

/** Fetch findings for an analysis, ordered by score desc
 * (`GET /analyses/{id}/findings`). */
export async function getFindings(analysisId: string): Promise<FindingsResponse> {
  return apiFetch<FindingsResponse>(`/analyses/${encodeURIComponent(analysisId)}/findings`);
}

export async function getFinding(
  analysisId: string,
  findingId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<FindingDetailResponse> {
  return apiFetch<FindingDetailResponse>(
    `/analyses/${encodeURIComponent(analysisId)}/findings/${encodeURIComponent(findingId)}`,
    { signal },
  );
}

/**
 * Fetch control recommendations, ranked by estimated risk reduction
 * (`GET /analyses/{id}/controls/recommendations`, spec section 12.5).
 */
export async function getControlRecommendations(
  analysisId: string,
): Promise<RecommendationsResponse> {
  return apiFetch<RecommendationsResponse>(
    `/analyses/${encodeURIComponent(analysisId)}/controls/recommendations`,
  );
}

/**
 * Run the rule engine for an analysis (`POST /analyses/{id}/analyze`).
 *
 * This is the ANALYZE stage: it produces findings and overwrites the stored
 * analysis, returning the summary, graph and findings. Pass `request` (the
 * user's edited graph) so the findings follow the edits; omit it to analyze the
 * parsed graph as-is (the first run when nothing was edited).
 */
export async function analyze(
  analysisId: string,
  request?: AnalyzeRequest,
): Promise<AnalyzeResponse> {
  return apiFetch<AnalyzeResponse>(`/analyses/${encodeURIComponent(analysisId)}/analyze`, {
    method: "POST",
    ...(request
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }
      : {}),
  });
}

/**
 * Simulate applying a set of controls and return the before/after risk plus the
 * mitigated graph (`POST /analyses/{id}/simulate-controls`, spec section 12.6).
 */
export async function simulateControls(
  analysisId: string,
  controlsToApply: ControlApplication[],
): Promise<SimulateControlsResponse> {
  return apiFetch<SimulateControlsResponse>(
    `/analyses/${encodeURIComponent(analysisId)}/simulate-controls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ controls_to_apply: controlsToApply }),
    },
  );
}
