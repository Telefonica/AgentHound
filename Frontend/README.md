# AgentHound Frontend

Next.js (App Router) + [Mistica](https://mistica-web.vercel.app/) web app for AgentHound. The threat-model wizard uploads an architecture YAML, calls the backend analysis API, and renders the capability graph, findings, and risk metrics.

For the full-stack setup (backend + frontend together), see the [root README](../README.md#running-locally).

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) (the repo pins `pnpm@11`)
- A running backend (default `http://localhost:8000`; see the [root README](../README.md#running-locally))

## Commands

```bash
pnpm install     # install dependencies
pnpm dev         # start the dev server on http://localhost:3000
pnpm build       # production build
pnpm start       # serve the production build
pnpm test:ts     # type-check (tsc --noEmit)
pnpm lint        # eslint
pnpm test        # unit (Node) and component (jsdom) tests with Vitest
pnpm test:visual # Playwright visual regression tests against a production build
```

The visual baselines (`tests/visual/**/*-chromium-darwin.png`) were generated on
macOS, so for now `pnpm test:visual` only passes there. On Linux or Windows,
generate local baselines first with `pnpm test:visual:update` and do not commit them.
The visual run builds into `.next-visual/`, so it leaves the regular `.next/` alone.

## Configuration

The backend base URL defaults to `http://localhost:8000`. Override it with an
environment variable (e.g. in `.env.local`):

```bash
NEXT_PUBLIC_AGENTHOUND_API_URL=http://localhost:8000
```

## Backend integration

The API layer lives in [`src/lib/api/`](src/lib/api/):

- `client.ts` — `fetch` wrapper; resolves the base URL and maps the backend error envelope to an `ApiError`.
- `agentHound.ts` — endpoint calls: `createAnalysis` (parse only), `analyze` (run the rule engine, optionally over the edited graph), `getGraph`, `getFindings`, `getFinding` (one finding plus its path subgraph, drawn alone from the graph toolbar), `getControlRecommendations`, `simulateControls`.
- `types.ts` — raw backend (snake_case) response shapes.
- `adapters.ts` — maps backend shapes to the camelCase UI types. Because the backend graph carries no coordinates, `toGraphNodes` assigns node `x`/`y` with a swimlane layout (one lane per node type); attack overlays are derived from critical/high finding paths. `toSolutionResult` maps the recommend + simulate responses into the **Proposed Solution** (before/after metrics, remediation timeline, and the mitigated graph with `blocked`/`mitigated` edges and applied-control nodes).

The wizard's **Inference** step is backed by the real parsed graph: `createAnalysis` parses the YAML, the step shows the inferred per-agent capabilities for review/correction, and on continuing to Results `analyze` runs the rule engine over the (possibly edited) graph — so the findings, scores, and counts follow the user's edits. The **Proposed Solution** tab is wired to the Phase 2 endpoints.

The **Results** step splits findings into two sections keyed on each finding's `findingClass` (`attack` / `hygiene`, mapped from the backend `finding_class`): exploitable **attack paths** are shown first, hygiene and compliance signals second, so the hygiene volume does not bury the critical paths.
