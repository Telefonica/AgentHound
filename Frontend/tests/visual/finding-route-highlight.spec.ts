import { test, expect, type Page } from "@playwright/test";
import { mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

async function openResults(page: Page) {
  await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
  await page.getByTestId("prioritized-finding").first().waitFor();
  await page.getByTestId("prioritized-finding-group").filter({ hasText: /^FH-011/ }).click();
  await settle(page);
}

const prioritized = (page: Page) => page.getByTestId("prioritized-findings");
const canvas = (page: Page) => page.locator("[data-ch-canvas]");
const routePanel = (page: Page) => canvas(page).getByRole("status");
const row = (page: Page, label: string) =>
  page.getByTestId("prioritized-finding").filter({ hasText: new RegExp(`^${label}(?!\\d)`) });
const graphNode = (page: Page, id: string) => canvas(page).locator(`.react-flow__node[data-id="${id}"]`);
const nodeIds = async (page: Page, classes: string) =>
  (await canvas(page).locator(`.react-flow__node:is(${classes})`).evaluateAll((els) => els.map((el) => el.dataset.id ?? ""))).sort();
const card = (page: Page, label: string) =>
  page.getByTestId("finding-card").filter({ hasText: new RegExp(`${label}(?!\\d)`) });

// Restacking the edges after their classes change shifts anti-aliasing slightly.
const RESTACKED = { maxDiffPixelRatio: 0.005 };

async function expectNormalView(page: Page) {
  await expect(routePanel(page)).toHaveCount(0);
  await expect(canvas(page).locator(".ch-hl, .ch-edge-hl, .ch-dim")).toHaveCount(0);
  await expect(canvas(page)).toHaveScreenshot("graph-default.png", RESTACKED);
}

async function openAttackGroup(page: Page) {
  await page.getByRole("button", { name: /Rutas de ataque/ }).click();
}

async function openPattern(page: Page, ruleId: string) {
  await page.getByTestId("finding-pattern").filter({ hasText: ruleId }).getByRole("button", { name: /ocurrencias/ }).click();
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Finding route highlight", () => {
  test("shows the full graph with numbered duplicates in the expanded group", async ({ page }) => {
    await openResults(page);

    await expect(routePanel(page)).toHaveCount(0);
    await expect(row(page, "FH-011 #1")).toHaveCount(1);
    await expect(row(page, "FH-011 #2")).toHaveCount(1);
    await expect(graphNode(page, "tool_customer_records_database_read").getByTestId("node-sub")).toHaveText("capability: read");
    await expect(graphNode(page, "tool_customer_records_delete").getByTestId("node-sub")).toHaveText("capability: deleteResource");
    // toHaveText reads the DOM, so check that no subtitle is clipped on screen.
    // 1px of slack: a fractional line height rounds scrollHeight up.
    const clipped = await canvas(page).getByTestId("node-sub").evaluateAll((els) =>
      els.filter((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
    );
    expect(clipped).toEqual([]);
    // Nodes render at the fixed height the layout reserves, so their content must fit in it.
    const overflowing = await canvas(page).locator(".ch-node:not(.ch-reactor)").evaluateAll((els) =>
      els.filter((el) => el.scrollHeight > el.clientHeight + 1).map((el) => el.textContent),
    );
    expect(overflowing).toEqual([]);
    await expect(canvas(page)).toHaveScreenshot("graph-default.png");
    await expect(prioritized(page)).toHaveScreenshot("prioritized-list-fh-011-expanded.png");
  });

  test("singles out a finding's route from the prioritized list", async ({ page }) => {
    await openResults(page);

    await row(page, "FH-011 #1").click();

    await expect(routePanel(page)).toContainText("FH-011 #1");
    await expect(row(page, "FH-011 #1")).toHaveAttribute("aria-current", "true");
    await expect(canvas(page)).toHaveScreenshot("graph-fh-011-1.png");
    await expect(prioritized(page)).toHaveScreenshot("prioritized-list-fh-011-1-selected.png");
  });

  test("tells duplicates apart: the second FH-011 lights a different branch", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-011 #1").click();
    await expect(routePanel(page)).toContainText("FH-011 #1");
    const first = await canvas(page).screenshot();

    await row(page, "FH-011 #2").click();

    await expect(routePanel(page)).toContainText("FH-011 #2");
    await expect(row(page, "FH-011 #1")).not.toHaveAttribute("aria-current", "true");
    await expect(canvas(page)).toHaveScreenshot("graph-fh-011-2.png");
    expect(await canvas(page).screenshot()).not.toEqual(first);
  });

  test("highlights a single-node finding from an accordion card and brings the graph into view", async ({ page }) => {
    await openResults(page);
    await openAttackGroup(page);
    await card(page, "FH-005 #1").scrollIntoViewIfNeeded();
    await expect(canvas(page)).not.toBeInViewport();

    await card(page, "FH-005 #1").click();

    await expect(canvas(page)).toBeInViewport();
    await expect(routePanel(page)).toContainText("FH-005 #1");
    await expect(card(page, "FH-005 #1")).toHaveAttribute("aria-current", "true");
    await expect(canvas(page).locator(".react-flow__node.ch-hl")).toHaveCount(1);
    await expect(canvas(page).locator(".react-flow__edge.ch-edge-hl")).toHaveCount(0);
    await expect(canvas(page).locator(".react-flow__edge:not(.ch-dim)")).toHaveCount(0);
    await expect(canvas(page)).toHaveScreenshot("graph-fh-005-1.png");
  });

  test("shows the selected accordion card", async ({ page }) => {
    await openResults(page);
    await openAttackGroup(page);
    await openPattern(page, "FH-011");

    await card(page, "FH-011 #2").click();

    await expect(card(page, "FH-011 #2")).toHaveScreenshot("card-fh-011-2-selected.png");
  });

  test("restores the full graph with “Ver todo”", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-002").click();
    await expect(routePanel(page)).toBeVisible();

    await routePanel(page).getByRole("button", { name: /Ver todo/ }).click();

    await expect(row(page, "FH-002")).not.toHaveAttribute("aria-current", "true");
    await expectNormalView(page);
  });

  test("restores the full graph with Escape and with a second press", async ({ page }) => {
    await openResults(page);

    await row(page, "FH-002").click();
    await expect(routePanel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expectNormalView(page);

    await row(page, "FH-002").click();
    await expect(routePanel(page)).toBeVisible();
    await row(page, "FH-002").click();
    await expectNormalView(page);
  });

  test("keeps the highlight when Escape closes a node's drawer", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-011 #1").click();
    await expect(routePanel(page)).toBeVisible();

    await canvas(page).locator(".react-flow__node.ch-hl").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(routePanel(page)).toContainText("FH-011 #1");
  });

  test("keeps the highlight legible in dark mode", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("colorScheme", "dark"));
    await openResults(page);

    await row(page, "FH-011 #2").click();

    await expect(routePanel(page)).toContainText("FH-011 #2");
    await expect(canvas(page)).toHaveScreenshot("graph-fh-011-2-dark.png");
  });

  test("lets the attack playback take over and brings the highlight back when it stops", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-011 #2").click();
    await expect(routePanel(page)).toBeVisible();

    await canvas(page).getByRole("button", { name: "Reproducir FH-011 #2" }).click();

    await expect(routePanel(page)).toContainText("Reproduciendo ruta");
    await expect(routePanel(page)).toContainText("FH-011 #2");
    await expect(routePanel(page).getByRole("button", { name: /Ver todo/ })).toHaveCount(0);
    await expect(canvas(page).locator(".react-flow__node.ch-hl")).toHaveCount(0);
    await expect(canvas(page).locator(".react-flow__node.ch-current")).toHaveCount(1);

    await canvas(page).getByRole("button", { name: "Detener" }).click();

    await expect(routePanel(page)).toContainText("FH-011 #2");
    await expect(canvas(page).locator(".react-flow__node.ch-current")).toHaveCount(0);
    await expect(canvas(page)).toHaveScreenshot("graph-fh-011-2.png", RESTACKED);
  });

  test("plays the selected finding's route instead of the primary attack", async ({ page }) => {
    await openResults(page);
    await expect(canvas(page).getByRole("button", { name: "Reproducir ataque" })).toBeVisible();

    for (const label of ["FH-011 #2", "FH-002"]) {
      await row(page, label).click();
      await expect(routePanel(page)).toContainText(label);
      const route = await nodeIds(page, ".ch-hl");

      await canvas(page).getByRole("button", { name: `Reproducir ${label}` }).click();

      await expect.poll(() => nodeIds(page, ".ch-current, .ch-live")).toEqual(route);
      await canvas(page).getByRole("button", { name: "Detener" }).click();
      await expect(routePanel(page)).toContainText(label);
    }
  });

  test("finishes the route it started when another finding is selected mid-run", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-002").click();
    const other = await nodeIds(page, ".ch-hl");
    await row(page, "FH-011 #2").click();
    const started = await nodeIds(page, ".ch-hl");
    expect(started).not.toEqual(other);

    await canvas(page).getByRole("button", { name: "Reproducir FH-011 #2" }).click();
    await row(page, "FH-002").click();

    await expect(canvas(page).getByRole("button", { name: "Detener" })).toBeVisible();
    await expect(routePanel(page)).toContainText("FH-011 #2");
    await expect(routePanel(page)).toContainText("FH-002 se resaltará al terminar");
    await expect.poll(() => nodeIds(page, ".ch-current, .ch-live")).toEqual(started);
    await canvas(page).getByRole("button", { name: "Detener" }).click();
    await expect(routePanel(page)).toContainText("FH-002");
  });

  test("does not let an earlier run's delayed reset cut a replay short", async ({ page }) => {
    await page.clock.install();
    await openResults(page);
    await row(page, "FH-011 #2").click();
    const steps = (await nodeIds(page, ".ch-hl")).length;
    const play = canvas(page).getByRole("button", { name: "Reproducir FH-011 #2" });
    const stop = canvas(page).getByRole("button", { name: "Detener" });

    await play.click();
    await page.clock.runFor(760 * steps);
    await stop.click();
    await play.click();
    await page.clock.runFor(1600);

    await expect(stop).toBeVisible();
    await expect(canvas(page).locator(".react-flow__node.ch-current")).toHaveCount(1);
  });

  test("keeps the highlight in fullscreen and clears it without leaving fullscreen", async ({ page }) => {
    await openResults(page);
    await row(page, "FH-011 #1").click();

    await canvas(page).getByRole("button", { name: "Pantalla completa" }).click();

    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute("data-ch-canvas"))).toBe(true);
    await expect(routePanel(page)).toContainText("FH-011 #1");
    await expect(page).toHaveScreenshot("graph-fh-011-1-fullscreen.png");

    await routePanel(page).getByRole("button", { name: /Ver todo/ }).click();

    await expect(routePanel(page)).toHaveCount(0);
    await expect(canvas(page).locator(".ch-hl, .ch-edge-hl, .ch-dim")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  });
});
