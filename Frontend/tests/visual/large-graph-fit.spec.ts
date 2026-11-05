import { test, expect, type Page } from "@playwright/test";
import graph from "./fixtures/ops-destructive/graph.json" with { type: "json" };
import { API_ORIGIN, mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";

const BRANCHES = 28;

// Grows the real graph to 64 nodes with tool → data branches off one agent: two
// tall dagre ranks that need well under the default 0.25 zoom to fit.
function largeGraph() {
  const nodes: object[] = [...graph.nodes];
  const edges: object[] = [...graph.edges];
  for (let i = 0; i < BRANCHES; i++) {
    const tool = `tool_extra_${i}`;
    const data = `asset_extra_${i}`;
    nodes.push(
      { id: tool, label: `extra tool ${i}`, type: "tool", risk_score: 1, properties: {}, badges: [] },
      { id: data, label: `extra data ${i}`, type: "data_asset", risk_score: 1, properties: {}, badges: [] },
    );
    edges.push(
      { ...graph.edges[0], id: `edge_extra_tool_${i}`, source: "agent_ops_executor", target: tool, finding_ids: [] },
      { ...graph.edges[1], id: `edge_extra_data_${i}`, source: tool, target: data, finding_ids: [] },
    );
  }
  return { nodes, edges };
}

const canvas = (page: Page) => page.locator("[data-ch-canvas]");

async function expectWholeGraphVisible(page: Page) {
  await expect(canvas(page).locator(".react-flow__node")).toHaveCount(graph.nodes.length + BRANCHES * 2);
  await expect(async () => {
    const frame = (await canvas(page).boundingBox())!;
    const boxes = await canvas(page).locator(".react-flow__node").evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect),
    );
    for (const b of boxes) {
      expect(b.top).toBeGreaterThanOrEqual(frame.y);
      expect(b.left).toBeGreaterThanOrEqual(frame.x);
      expect(b.bottom).toBeLessThanOrEqual(frame.y + frame.height);
      expect(b.right).toBeLessThanOrEqual(frame.x + frame.width);
    }
  }).toPass({ timeout: 5_000 });
}

const zoom = (page: Page) =>
  canvas(page).locator(".react-flow__viewport").evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);

async function settledZoom(page: Page) {
  let previous = NaN;
  await expect.poll(async () => previous === (previous = await zoom(page)), { intervals: [250] }).toBe(true);
  return previous;
}

function graphOf(drawn: number, controls: number) {
  const nodes: object[] = [...graph.nodes];
  const edges: object[] = [...graph.edges];
  for (let i = graph.nodes.length; i < drawn; i++) {
    nodes.push({ id: `tool_extra_${i}`, label: `extra tool ${i}`, type: "tool", risk_score: 1, properties: {}, badges: [] });
    edges.push({ ...graph.edges[0], id: `edge_extra_${i}`, source: "agent_ops_executor", target: `tool_extra_${i}`, finding_ids: [] });
  }
  for (let i = 0; i < controls; i++) {
    nodes.push({ id: `control_extra_${i}`, label: `extra control ${i}`, type: "control", risk_score: 0, properties: {}, badges: [] });
  }
  return { nodes, edges };
}

async function serveGraph(page: Page, body: object) {
  await page.route(`${API_ORIGIN}/analyses/${OPS_DESTRUCTIVE_ID}/graph`, (route) =>
    route.request().method() === "OPTIONS"
      ? route.fallback()
      : route.fulfill({
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" },
          contentType: "application/json",
          body: JSON.stringify(body),
        }),
  );
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
  await serveGraph(page, largeGraph());
  await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
  await page.getByTestId("prioritized-finding").first().waitFor();
});

test.describe("Large graph fit", () => {
  test("fits the whole graph on load", async ({ page }) => {
    await expectWholeGraphVisible(page);
  });

  test("fits the whole graph again with Ajustar after zooming in", async ({ page }) => {
    await expectWholeGraphVisible(page);
    await canvas(page).hover();
    await page.mouse.wheel(0, -1200);

    await canvas(page).getByRole("button", { name: "Ajustar" }).click();

    await expectWholeGraphVisible(page);
  });

  test("does not snap past the fit when zooming out from it", async ({ page }) => {
    await expectWholeGraphVisible(page);
    const fit = await settledZoom(page);
    await canvas(page).hover();

    await page.mouse.wheel(0, 400);

    // Waits for the wheel to land, so a snap back up cannot be missed.
    await expect.poll(() => zoom(page)).not.toBe(fit);
    expect(await settledZoom(page)).toBeLessThan(fit);
    await expectWholeGraphVisible(page);
  });
});

const minimap = (page: Page) => canvas(page).locator(".react-flow__minimap");
const viewportTransform = (page: Page) =>
  canvas(page).locator(".react-flow__viewport").evaluate((el) => getComputedStyle(el).transform);

test.describe("Large graph overview map", () => {
  test("draws every node of a large graph in the overview map", async ({ page }) => {
    await expectWholeGraphVisible(page);

    await expect(canvas(page).getByRole("img", { name: "Vista general del grafo" })).toBeVisible();
    await expect(minimap(page).locator(".react-flow__minimap-node")).toHaveCount(graph.nodes.length + BRANCHES * 2);
    await settledZoom(page);
    await expect(minimap(page)).toHaveScreenshot("minimap-large-graph.png");
  });

  test("frames the visible part of the graph once zoomed in", async ({ page }) => {
    await expectWholeGraphVisible(page);
    await canvas(page).hover();
    await page.mouse.wheel(0, -1200);
    await settledZoom(page);

    await expect(minimap(page)).toHaveScreenshot("minimap-zoomed-in.png");
  });

  test("reads in dark mode", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("colorScheme", "dark"));
    await page.reload();
    await expectWholeGraphVisible(page);
    await settledZoom(page);

    await expect(minimap(page)).toHaveScreenshot("minimap-large-graph-dark.png");
  });

  test("frames the visible part of the graph in dark mode", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("colorScheme", "dark"));
    await page.reload();
    await expectWholeGraphVisible(page);
    await canvas(page).hover();
    await page.mouse.wheel(0, -1200);
    await settledZoom(page);

    await expect(minimap(page)).toHaveScreenshot("minimap-zoomed-in-dark.png");
  });

  test("moves the canvas when the overview map is dragged", async ({ page }) => {
    await expectWholeGraphVisible(page);
    await canvas(page).hover();
    await page.mouse.wheel(0, -1200);
    await settledZoom(page);
    const before = await viewportTransform(page);

    const map = (await minimap(page).boundingBox())!;
    await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
    await page.mouse.down();
    await page.mouse.move(map.x + map.width / 4, map.y + map.height / 4, { steps: 5 });
    await page.mouse.up();

    await expect.poll(() => viewportTransform(page)).not.toBe(before);
  });

  for (const width of [1280, 1440]) {
    test(`keeps the route panel clear of the overview map at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await expectWholeGraphVisible(page);
      await page.getByTestId("prioritized-finding").first().click();
      const panel = canvas(page).getByRole("status");
      await expect(panel).toBeVisible();
      await expect(minimap(page)).toBeVisible();

      const a = (await panel.boundingBox())!;
      const b = (await minimap(page).boundingBox())!;
      const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlaps).toBe(false);
    });
  }

  for (const width of [1024, 1100]) {
    test(`hides the overview map on the narrow canvas at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await expectWholeGraphVisible(page);

      await expect(minimap(page)).toHaveCount(0);
    });
  }

  test("shows the overview map in fullscreen when the window is too narrow for it", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await expectWholeGraphVisible(page);
    await expect(minimap(page)).toHaveCount(0);

    await canvas(page).getByRole("button", { name: "Pantalla completa" }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute("data-ch-canvas"))).toBe(true);

    await expect(minimap(page)).toBeVisible();
  });

  test("dims the nodes outside a highlighted route in the overview map", async ({ page }) => {
    await expectWholeGraphVisible(page);
    await page.getByTestId("prioritized-finding").first().click();
    await expect(canvas(page).getByRole("status")).toBeVisible();

    const dimmed = await canvas(page).locator(".react-flow__node.ch-dim").count();
    expect(dimmed).toBeGreaterThan(0);
    await expect(minimap(page).locator(".react-flow__minimap-node.ch-dim")).toHaveCount(dimmed);
    await expect(minimap(page).locator(".react-flow__minimap-node:not(.ch-dim)")).toHaveCount(
      graph.nodes.length + BRANCHES * 2 - dimmed,
    );
    await expect(minimap(page).locator(".ch-hl, .ch-live, .ch-current")).toHaveCount(0);
  });

  for (const [drawn, shown] of [[14, false], [15, true]] as const) {
    test(`${shown ? "shows" : "hides"} the overview map with ${drawn} drawn nodes and controls left out`, async ({ page }) => {
      await serveGraph(page, graphOf(drawn, 3));
      await page.reload();
      await expect(canvas(page).locator(".react-flow__node")).toHaveCount(drawn);

      await expect(minimap(page)).toHaveCount(shown ? 1 : 0);
    });
  }
});
