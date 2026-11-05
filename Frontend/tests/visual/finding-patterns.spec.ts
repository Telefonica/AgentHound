import { test, expect, type Page } from "@playwright/test";
import { mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";

const pattern = (page: Page, ruleId: string) => page.getByTestId("finding-pattern").filter({ hasText: ruleId });
const occurrences = (page: Page, ruleId: string) => pattern(page, ruleId).getByRole("button", { name: /ocurrencias/ });

async function openAttackGroup(page: Page) {
  await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
  await page.getByRole("button", { name: /Rutas de ataque/ }).click();
  await pattern(page, "FH-011").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Finding patterns", () => {
  test("folds a repeated cause into one card in the findings accordion", async ({ page }) => {
    await openAttackGroup(page);

    await expect(page.getByRole("button", { name: /Rutas de ataque/ })).toContainText("causas");
    await expect(pattern(page, "FH-011")).toContainText("2 hallazgos");
    await expect(page.getByTestId("finding-card").filter({ hasText: "FH-011 #1" })).toHaveCount(0);
    await expect(pattern(page, "FH-011")).toHaveScreenshot("pattern-fh-011-collapsed.png");
  });

  test("unfolds the occurrences of a cause with their own label and route", async ({ page }) => {
    await openAttackGroup(page);
    await occurrences(page, "FH-011").click();

    await expect(occurrences(page, "FH-011")).toHaveAttribute("aria-expanded", "true");
    await expect(pattern(page, "FH-011").getByTestId("finding-card")).toHaveCount(2);
    await expect(pattern(page, "FH-011")).toHaveScreenshot("pattern-fh-011-expanded.png");
  });

  test("unfolds the cause of a finding picked in the graph", async ({ page }) => {
    await openAttackGroup(page);
    await expect(occurrences(page, "FH-011")).toHaveAttribute("aria-expanded", "false");

    const box = page.getByTestId("prioritized-findings");
    await box.getByTestId("prioritized-finding-group").filter({ hasText: "FH-011" }).click();
    await box.getByTestId("prioritized-finding").filter({ hasText: "FH-011 #2" }).click();

    await expect(occurrences(page, "FH-011")).toHaveAttribute("aria-expanded", "true");
    await expect(pattern(page, "FH-011").getByTestId("finding-card").filter({ hasText: "FH-011 #2" })).toHaveAttribute("aria-current", "true");
  });

  test("shows the risk reduction counting each cause once", async ({ page }) => {
    await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
    await page.getByRole("tab", { name: "Solución propuesta" }).click();

    await expect(page.getByText("Reducción por causa")).toBeVisible();
    await expect(page.getByText("-50%", { exact: true })).toBeVisible();
  });

  test("lines up the before and after rows", async ({ page }) => {
    await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
    await page.getByRole("tab", { name: "Solución propuesta" }).click();
    await page.getByTestId("before-after").waitFor();
    await page.evaluate(() => document.fonts.ready);

    const [before, after] = await page.getByTestId("before-after-card").all();
    const rowTops = (card: typeof before) => card!.getByTestId("metric-row").evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().top));
    const [beforeTops, afterTops] = [await rowTops(before), await rowTops(after)];
    expect(afterTops.slice(0, beforeTops.length)).toEqual(beforeTops);
    await expect(page.getByTestId("before-after")).toHaveScreenshot("before-after.png");
  });

  test("keeps the before and after cards readable at the narrowest supported width", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
    await page.getByRole("tab", { name: "Solución propuesta" }).click();
    await page.getByTestId("before-after").waitFor();
    await page.evaluate(() => document.fonts.ready);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expect(page.getByTestId("before-after")).toHaveScreenshot("before-after-narrow.png");
  });
});
