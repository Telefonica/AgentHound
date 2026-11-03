import { test, expect, type Page } from "@playwright/test";
import fixture from "./fixtures/ops-destructive/findings.json" with { type: "json" };
import { API_ORIGIN, mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";

const COPIES = 12;

// Hospital scale: each root cause repeats a dozen times over.
function largeFindings() {
  const findings = Array.from({ length: COPIES }, (_, k) => fixture.findings.map((f) => ({ ...f, id: `${f.id}_${k}` })))
    .flat()
    .sort((a, b) => b.score - a.score);
  return { findings, groups: fixture.groups };
}

const LARGE = largeFindings();
const GROUPS = new Set(LARGE.findings.map((f) => f.group_id)).size;

const box = (page: Page) => page.getByTestId("prioritized-findings");
const groupRows = (page: Page) => page.getByTestId("prioritized-finding-group");
const rows = (page: Page) => page.getByTestId("prioritized-finding");
const topLevelRows = (page: Page) => box(page).locator('[data-testid="prioritized-finding-group"], [data-testid="prioritized-finding"]');
const firstGroup = (page: Page) => groupRows(page).first();
const routePanel = (page: Page) => page.locator("[data-ch-canvas]").getByRole("status");

async function openResults(page: Page) {
  await page.route(`${API_ORIGIN}/analyses/${OPS_DESTRUCTIVE_ID}/findings`, (route) =>
    route.request().method() === "OPTIONS"
      ? route.fallback()
      : route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*" }, contentType: "application/json", body: JSON.stringify(LARGE) }),
  );
  await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
  await box(page).waitFor();
  await page.evaluate(() => document.fonts.ready);
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Prioritized findings at scale", () => {
  test("shows only the top patterns, so the metrics stay right below the graph", async ({ page }) => {
    await openResults(page);

    await expect(box(page)).toContainText(`${LARGE.findings.length} hallazgos · ${GROUPS} patrones`);
    await expect(topLevelRows(page)).toHaveCount(5);
    const { height } = (await box(page).boundingBox())!;
    expect(height).toBeLessThan(320);
    const boxBottom = await box(page).evaluate((el) => el.getBoundingClientRect().bottom);
    const metricsTop = await page.getByRole("heading", { name: "Métricas de riesgo" }).evaluate((el) => el.getBoundingClientRect().top);
    expect(metricsTop - boxBottom).toBeLessThan(80);
    await expect(box(page)).toHaveScreenshot("prioritized-list-top-patterns.png");
  });

  test("reads a repeated cause as one row with its number of occurrences", async ({ page }) => {
    await openResults(page);

    await expect(firstGroup(page)).toHaveAttribute("aria-expanded", "false");
    await expect(firstGroup(page)).toHaveText(
      "FH-011Destructive modification from untrusted input desde Inbound maintenance ticket email · puntuación 1024 hallazgos",
    );
    await expect(rows(page).filter({ hasText: /^FH-011 #/ })).toHaveCount(0);
  });

  test("expands a pattern into its numbered occurrences and highlights the one pressed", async ({ page }) => {
    await openResults(page);

    await firstGroup(page).click();

    await expect(firstGroup(page)).toHaveAttribute("aria-expanded", "true");
    await expect(rows(page).filter({ hasText: /^FH-011 #/ })).toHaveCount(10);
    await expect(box(page)).toHaveScreenshot("prioritized-list-group-expanded.png");

    await box(page).getByRole("button", { name: "Ver 14 más" }).click();
    await expect(rows(page).filter({ hasText: /^FH-011 #/ })).toHaveCount(24);
    await box(page).getByRole("button", { name: "Ver solo los 10 primeros" }).click();
    await expect(rows(page).filter({ hasText: /^FH-011 #/ })).toHaveCount(10);

    const occurrence = rows(page).filter({ hasText: /^FH-011 #2(?!\d)/ });
    await occurrence.click();

    await expect(routePanel(page)).toContainText("FH-011 #2");
    await expect(occurrence).toHaveAttribute("aria-current", "true");
  });

  test("keeps the selection visible on a collapsed pattern", async ({ page }) => {
    await openResults(page);
    await firstGroup(page).click();
    await rows(page).filter({ hasText: /^FH-011 #2(?!\d)/ }).click();

    await firstGroup(page).click();

    await expect(routePanel(page)).toContainText("FH-011 #2");
    await expect(firstGroup(page)).toHaveScreenshot("prioritized-group-holding-selection.png");
  });

  test("tells apart patterns of one rule by the node they sit in", async ({ page }) => {
    await openResults(page);

    await expect(groupRows(page).filter({ hasText: /^FH-005/ })).toHaveText([
      /^FH-005Tool with side effect missing approval and rollback en customer_records_delete/,
      /^FH-005Tool with side effect missing approval and rollback en crm_records_update/,
    ]);
  });

  test("lists every pattern on demand and folds back to the top ones", async ({ page }) => {
    await openResults(page);
    const collapsed = (await box(page).boundingBox())!.height;

    await box(page).getByRole("button", { name: `Ver los ${GROUPS} patrones` }).click();

    await expect(topLevelRows(page)).toHaveCount(GROUPS);
    await expect(box(page).getByRole("button", { name: "Ver solo los 5 primeros" })).toHaveAttribute("aria-expanded", "true");

    await box(page).getByRole("button", { name: "Ver solo los 5 primeros" }).click();

    await expect(topLevelRows(page)).toHaveCount(5);
    expect((await box(page).boundingBox())!.height).toBe(collapsed);
  });

  test("keeps the patterns legible in dark mode", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("colorScheme", "dark"));
    await openResults(page);

    await firstGroup(page).click();

    await expect(box(page)).toHaveScreenshot("prioritized-list-group-expanded-dark.png");
  });
});
