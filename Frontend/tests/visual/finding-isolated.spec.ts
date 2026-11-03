import { test, expect, type Page } from "@playwright/test";
import { API_ORIGIN, mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";

async function openResults(page: Page) {
  await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
  await page.getByTestId("prioritized-finding").first().waitFor();
  await page.getByTestId("prioritized-finding-group").filter({ hasText: /^FH-011/ }).click();
  await page.evaluate(() => document.fonts.ready);
}

const canvas = (page: Page) => page.locator("[data-ch-canvas]");
const routePanel = (page: Page) => canvas(page).getByRole("status");
const row = (page: Page, label: string) =>
  page.getByTestId("prioritized-finding").filter({ hasText: new RegExp(`^${label}(?!\\d)`) });
const nodeIds = async (page: Page) =>
  (await canvas(page).locator(".react-flow__node").evaluateAll((els) => els.map((el) => el.dataset.id ?? ""))).sort();

const FH_011_1_ROUTE = [
  "agent_ops_executor",
  "agent_ticket_intake",
  "asset_customer_records_delete_resource",
  "input_inbound_maintenance_ticket_email",
  "tool_customer_records_delete",
];

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Isolated finding", () => {
  test("offers isolation only once a finding is selected", async ({ page }) => {
    await openResults(page);
    await expect(canvas(page).getByRole("button", { name: "Aislar ruta" })).toHaveCount(0);

    await row(page, "FH-011 #1").click();

    await expect(canvas(page).getByRole("button", { name: "Aislar ruta" })).toBeVisible();
  });

  test("draws only the finding's own nodes and edges from its endpoint", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-011 #1").click();
    const request = page.waitForRequest(`${API_ORIGIN}/analyses/${OPS_DESTRUCTIVE_ID}/findings/finding_001`);

    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();
    await request;

    await expect(routePanel(page)).toContainText("Hallazgo aislado");
    await expect(routePanel(page)).toContainText("FH-011 #1");
    await expect.poll(() => nodeIds(page)).toEqual(FH_011_1_ROUTE);
    await expect(canvas(page).locator(".react-flow__edge")).toHaveCount(4);
    await expect(canvas(page).locator(".ch-dim, .ch-hl")).toHaveCount(0);
    await expect(canvas(page)).toHaveScreenshot("graph-fh-011-1-isolated.png");
  });

  test("plays the isolated route", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-011 #1").click();
    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();
    await expect(routePanel(page)).toContainText("Hallazgo aislado");

    await canvas(page).getByRole("button", { name: "Reproducir FH-011 #1" }).click();

    await expect(routePanel(page)).toContainText("Reproduciendo ruta");
    await expect(canvas(page).locator(".react-flow__node.ch-current")).toHaveCount(1);
  });

  test("goes back to the whole graph in context and with “Ver todo”", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-011 #1").click();
    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();
    await expect.poll(() => nodeIds(page)).toEqual(FH_011_1_ROUTE);

    await canvas(page).getByRole("button", { name: "Ver en contexto" }).click();

    await expect(canvas(page).locator(".react-flow__node")).toHaveCount(9);
    await expect(routePanel(page)).toContainText("Ruta resaltada");

    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();
    await expect.poll(() => nodeIds(page)).toEqual(FH_011_1_ROUTE);
    await routePanel(page).getByRole("button", { name: /Ver todo/ }).click();

    await expect(routePanel(page)).toHaveCount(0);
    await expect(canvas(page).locator(".react-flow__node")).toHaveCount(9);
  });

  test("isolates without leaving fullscreen", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-011 #1").click();
    await canvas(page).getByRole("button", { name: "Pantalla completa" }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute("data-ch-canvas"))).toBe(true);

    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();

    await expect.poll(() => nodeIds(page)).toEqual(FH_011_1_ROUTE);
    await expect(routePanel(page)).toContainText("Hallazgo aislado");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    await expect(page).toHaveScreenshot("graph-fh-011-1-isolated-fullscreen.png");

    await canvas(page).getByRole("button", { name: "Ver en contexto" }).click();

    await expect(canvas(page).locator(".react-flow__node")).toHaveCount(9);
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  });

  test("drops the fullscreen title below the toolbar only when they would overlap", async ({ page }) => {
    const title = () => canvas(page).getByTestId("fullscreen-title");
    const toolbar = () => canvas(page).getByTestId("graph-toolbar");
    // The title eases between rows, so read the layout once it has settled.
    const layout = async () => {
      const box = async () => {
        const [t, b] = await Promise.all([title().boundingBox(), toolbar().boundingBox()]);
        return { t: t!, b: b! };
      };
      let prev = await box();
      for (;;) {
        await page.waitForTimeout(100);
        const next = await box();
        if (next.t.y === prev.t.y) break;
        prev = next;
      }
      const { t, b } = prev;
      return { below: t.y >= b.y + b.height, overlaps: t.x + t.width > b.x && t.y < b.y + b.height };
    };

    await openResults(page);
    await row(page, "FH-011 #1").click();
    await canvas(page).getByRole("button", { name: "Pantalla completa" }).click();
    await expect(title()).toBeVisible();
    expect(await layout()).toEqual({ below: true, overlaps: false });

    await canvas(page).getByRole("button", { name: "Ver todo" }).click();
    expect(await layout()).toEqual({ below: false, overlaps: false });

    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await page.setViewportSize({ width: 1100, height: 900 });
    await canvas(page).getByRole("button", { name: "Pantalla completa" }).click();
    await expect(title()).toBeVisible();
    expect(await layout()).toEqual({ below: true, overlaps: false });
  });

  test("keeps the isolated route legible in dark mode", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("colorScheme", "dark"));
    await openResults(page);
    await row(page, "FH-011 #1").click();

    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();

    await expect.poll(() => nodeIds(page)).toEqual(FH_011_1_ROUTE);
    await expect(canvas(page)).toHaveScreenshot("graph-fh-011-1-isolated-dark.png");
  });

  test("keeps the previous finding dimmed on screen while the next one loads", async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route(/\/findings\/(?!finding_001)[^/]+$/, async (route) => {
      await held;
      await route.fulfill({ status: 500, body: "{}" });
    });
    await openResults(page);
    await row(page, "FH-011 #1").click();
    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();
    await expect.poll(() => nodeIds(page)).toEqual(FH_011_1_ROUTE);

    await row(page, "FH-011 #2").click();

    await expect(canvas(page).getByTestId("pending-route")).toHaveText("Cargando FH-011 #2…");
    await expect(canvas(page)).toHaveAttribute("aria-busy", "true");
    await expect.poll(() => nodeIds(page)).toEqual(FH_011_1_ROUTE);
    await expect(routePanel(page)).toContainText("FH-011 #1");
    await expect(canvas(page).getByRole("button", { name: /Reproducir/ })).toHaveCount(0);

    release();

    await expect(canvas(page).getByTestId("pending-route")).toHaveCount(0);
    await expect(canvas(page).locator(".react-flow__node")).toHaveCount(9);
    await expect(routePanel(page)).toContainText("No se pudo cargar la ruta de este hallazgo.");
  });

  test("keeps the whole graph and offers a retry when the subgraph cannot load", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-011 #2").click();

    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();

    await expect(routePanel(page)).toContainText("No se pudo cargar la ruta de este hallazgo.");
    await expect(canvas(page).getByRole("button", { name: "Reintentar ruta" })).toBeVisible();
    await expect(canvas(page).locator(".react-flow__node")).toHaveCount(9);
  });

  test("retries a failed load from the toolbar and isolates the route", async ({ page }) => {
    let failed = false;
    await page.route(/\/findings\/finding_001$/, (route) => {
      if (failed || route.request().method() !== "GET") return route.fallback();
      failed = true;
      return route.fulfill({ status: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" });
    });
    await openResults(page);
    await row(page, "FH-011 #1").click();

    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();
    await expect(routePanel(page)).toContainText("No se pudo cargar la ruta de este hallazgo.");

    await canvas(page).getByRole("button", { name: "Reintentar ruta" }).click();

    await expect.poll(() => nodeIds(page)).toEqual(FH_011_1_ROUTE);
    await expect(routePanel(page)).toContainText("Hallazgo aislado");
    await expect(routePanel(page)).not.toContainText("No se pudo cargar");
  });

  test("returns to the whole graph after a trip to the proposed solution", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-011 #1").click();
    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();
    await expect.poll(() => nodeIds(page)).toEqual(FH_011_1_ROUTE);

    const solutionTab = page.getByRole("tab", { name: "Solución propuesta" });
    const findingsTab = page.getByRole("tab", { name: "Hallazgos" });
    // Mística's tabs ignore a press that lands right after the previous tab change.
    const select = (tab: typeof solutionTab) =>
      expect(async () => {
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 500 });
      }).toPass();
    await select(solutionTab);
    await expect(page.getByRole("heading", { name: "Grafo de capacidades resuelto" })).toBeVisible();
    await select(findingsTab);

    await expect(canvas(page).getByRole("button", { name: "Aislar ruta" })).toBeVisible();
    await expect(canvas(page).locator(".react-flow__node")).toHaveCount(9);
    await expect(routePanel(page)).toContainText("Ruta resaltada");
  });

  test("hides the primary route card while a finding is isolated", async ({ page }) => {
    const primaryCard = page.getByText("Ruta crítica principal");
    await openResults(page);
    await row(page, "FH-011 #1").click();
    await expect(primaryCard).toBeVisible();

    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();
    await expect.poll(() => nodeIds(page)).toEqual(FH_011_1_ROUTE);
    await expect(primaryCard).toHaveCount(0);

    await canvas(page).getByRole("button", { name: "Ver en contexto" }).click();
    await expect(primaryCard).toBeVisible();
  });

  test("shows a failed load and its retry in fullscreen", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-011 #2").click();
    await canvas(page).getByRole("button", { name: "Pantalla completa" }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute("data-ch-canvas"))).toBe(true);

    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();

    await expect(routePanel(page)).toContainText("No se pudo cargar la ruta de este hallazgo.");
    await expect(canvas(page).getByRole("button", { name: "Reintentar ruta" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  });
});
