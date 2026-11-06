import type { Page, Route } from "@playwright/test";
import type { AnalysisListItem } from "../../src/lib/api/types";
import analysis from "./fixtures/ops-destructive/analysis.json" with { type: "json" };
import graph from "./fixtures/ops-destructive/graph.json" with { type: "json" };
import findings from "./fixtures/ops-destructive/findings.json" with { type: "json" };
import finding001 from "./fixtures/ops-destructive/finding-001.json" with { type: "json" };
import recommendations from "./fixtures/ops-destructive/recommendations.json" with { type: "json" };
import simulate from "./fixtures/ops-destructive/simulate.json" with { type: "json" };
import codeExecAnalysis from "./fixtures/data-codeexec/analysis.json" with { type: "json" };
import codeExecGraph from "./fixtures/data-codeexec/graph.json" with { type: "json" };
import codeExecFindings from "./fixtures/data-codeexec/findings.json" with { type: "json" };
import codeExecFinding001 from "./fixtures/data-codeexec/finding-001.json" with { type: "json" };
import codeExecRecommendations from "./fixtures/data-codeexec/recommendations.json" with { type: "json" };
import codeExecSimulate from "./fixtures/data-codeexec/simulate.json" with { type: "json" };
import capabilities from "./fixtures/capabilities.json" with { type: "json" };

export const API_ORIGIN = process.env.NEXT_PUBLIC_AGENTHOUND_API_URL ?? "http://localhost:8000";

// Real backend responses for examples/03_ops_destructive/langgraph.yaml.
export const OPS_DESTRUCTIVE_ID = analysis.analysis_id;

const OPS_DESTRUCTIVE: Record<string, unknown> = {
  [`GET /analyses/${OPS_DESTRUCTIVE_ID}`]: analysis,
  [`GET /analyses/${OPS_DESTRUCTIVE_ID}/graph`]: graph,
  [`GET /analyses/${OPS_DESTRUCTIVE_ID}/findings`]: findings,
  [`GET /analyses/${OPS_DESTRUCTIVE_ID}/findings/finding_001`]: finding001,
  [`GET /analyses/${OPS_DESTRUCTIVE_ID}/controls/recommendations`]: recommendations,
  [`POST /analyses/${OPS_DESTRUCTIVE_ID}/simulate-controls`]: simulate,
};

// Real backend responses for examples/02_data_codeexec/langgraph.yaml.
export const DATA_CODEEXEC_ID = codeExecAnalysis.analysis_id;

const DATA_CODEEXEC: Record<string, unknown> = {
  [`GET /analyses/${DATA_CODEEXEC_ID}`]: codeExecAnalysis,
  [`GET /analyses/${DATA_CODEEXEC_ID}/graph`]: codeExecGraph,
  [`GET /analyses/${DATA_CODEEXEC_ID}/findings`]: codeExecFindings,
  [`GET /analyses/${DATA_CODEEXEC_ID}/findings/finding_001`]: codeExecFinding001,
  [`GET /analyses/${DATA_CODEEXEC_ID}/controls/recommendations`]: codeExecRecommendations,
  [`POST /analyses/${DATA_CODEEXEC_ID}/simulate-controls`]: codeExecSimulate,
};

// Cross-origin backend: mocked responses still need CORS headers and the preflight.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function mockOpsDestructiveAnalysis(page: Page) {
  return mockAnalysis(page, OPS_DESTRUCTIVE);
}

export function mockDataCodeExecAnalysis(page: Page) {
  return mockAnalysis(page, DATA_CODEEXEC);
}

async function mockAnalysis(page: Page, responses: Record<string, unknown>) {
  await page.route(`${API_ORIGIN}/**`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const body = responses[`${request.method()} ${new URL(request.url()).pathname}`];
    if (body === undefined) {
      return route.fulfill({
        status: 404,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Not mocked" } }),
      });
    }
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
  });
}

export const OPS_DESTRUCTIVE_ITEM = analysis as AnalysisListItem;
export const DATA_CODEEXEC_ITEM = codeExecAnalysis as AnalysisListItem;

export function analysisItem(
  overrides: Partial<Omit<AnalysisListItem, "summary">> & { summary?: Partial<AnalysisListItem["summary"]> },
): AnalysisListItem {
  return { ...OPS_DESTRUCTIVE_ITEM, ...overrides, summary: { ...OPS_DESTRUCTIVE_ITEM.summary, ...overrides.summary } };
}

export const SUPPORT_MEDIUM_ITEM = analysisItem({
  analysis_id: "support-email",
  name: "Support Email Triage",
  source_framework: "crewai",
  uploaded_at: "2026-10-20T09:00:00+00:00",
  summary: { nodes: 5, edges: 4, findings: 3, critical: 0, high: 0, medium: 3, max_score: 5.4 },
});

export const CLEAN_ITEM = analysisItem({
  analysis_id: "hiresmart-pipeline",
  name: "HireSmart Pipeline (hardened)",
  source_framework: "dify",
  uploaded_at: "2026-10-15T09:00:00+00:00",
  summary: { nodes: 7, edges: 6, findings: 0, critical: 0, high: 0, medium: 0, max_score: 0 },
  warnings: [],
});

export const ANALYSES = [DATA_CODEEXEC_ITEM, OPS_DESTRUCTIVE_ITEM, SUPPORT_MEDIUM_ITEM, CLEAN_ITEM];

export const OPS_DESTRUCTIVE_PARSED = {
  analysis_id: analysis.analysis_id,
  status: "parsed",
  name: analysis.name,
  source_framework: analysis.source_framework,
  summary: { ...analysis.summary, findings: 0, critical: 0, high: 0, medium: 0, max_score: 0 },
  warnings: analysis.warnings,
};

export const OPS_DESTRUCTIVE_ANALYZED = {
  ...OPS_DESTRUCTIVE_PARSED,
  status: "analyzed",
  summary: analysis.summary,
  graph,
  findings: findings.findings,
  groups: findings.groups,
};

function fulfillJson(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
}

const SERVER_ERROR = { error: { code: "INTERNAL", message: "Internal server error" } };

export async function mockEndpoint(page: Page, method: string, path: string, body: unknown, status = 200) {
  await page.route(`${API_ORIGIN}${path}`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (request.method() !== method) return route.fallback();
    return fulfillJson(route, status, body);
  });
}

export function mockEndpointError(page: Page, method: string, path: string) {
  return mockEndpoint(page, method, path, SERVER_ERROR, 500);
}

export function mockAnalysesList(page: Page, items: ReadonlyArray<unknown> = ANALYSES) {
  return mockEndpoint(page, "GET", "/analyses", { analyses: items });
}

export function mockAnalysesListError(page: Page) {
  return mockEndpointError(page, "GET", "/analyses");
}

export function mockDeleteAnalysis(page: Page, id: string) {
  return mockEndpoint(page, "DELETE", `/analyses/${id}`, { analysis_id: id, status: "deleted" });
}

export function mockCreateAnalysis(page: Page, body: unknown = OPS_DESTRUCTIVE_PARSED, status = 200) {
  return mockEndpoint(page, "POST", "/analyses", body, status);
}

export function mockAnalyze(page: Page, id = OPS_DESTRUCTIVE_ID, body: unknown = OPS_DESTRUCTIVE_ANALYZED, status = 200) {
  return mockEndpoint(page, "POST", `/analyses/${id}/analyze`, body, status);
}

export function mockCapabilities(page: Page) {
  return mockEndpoint(page, "GET", "/capabilities", capabilities);
}
