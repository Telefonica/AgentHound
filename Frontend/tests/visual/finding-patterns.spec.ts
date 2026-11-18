import { test, expect, type Page } from "@playwright/test";
import { mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";
import { settle } from "./screen";

const pattern = (page: Page, ruleId: string) => page.getByTestId("finding-pattern").filter({ hasText: ruleId });
const occurrences = (page: Page, ruleId: string) => pattern(page, ruleId).getByRole("button", { name: /occurrences/ });
const graphDrawn = (page: Page) => page.locator("[data-ch-canvas] .react-flow__node").first().waitFor();

async function openAttackGroup(page: Page) {
  await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
  await graphDrawn(page);
  await page.getByRole("button", { name: /Attack Paths/ }).click();
  await pattern(page, "FH-011").waitFor();
  await settle(page);
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Finding patterns", () => {
  test("folds a repeated cause into one card in the findings accordion", async ({ page }) => {
    await openAttackGroup(page);

    await expect(page.getByRole("button", { name: /Attack Paths/ })).toContainText("causes");
    await expect(pattern(page, "FH-011").getByTestId("finding-count")).toHaveText("2 findings");
    await expect(page.getByTestId("finding-card").filter({ hasText: "FH-011 #1" })).toHaveCount(0);
    await expect(pattern(page, "FH-011")).toHaveScreenshot("pattern-fh-011-collapsed.png");
  });

  test("unfolds the occurrences of a cause with their own label and route", async ({ page }) => {
    await openAttackGroup(page);
    await occurrences(page, "FH-011").click();
    await page.mouse.move(0, 0);

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
    await page.getByRole("tab", { name: "Proposed Solution" }).click();

    await expect(page.getByText("Reduction by cause")).toBeVisible();
    await expect(page.getByText("-50%", { exact: true })).toBeVisible();
  });

  test("lines up the before and after rows", async ({ page }) => {
    await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
    await page.getByRole("tab", { name: "Proposed Solution" }).click();
    await page.getByTestId("before-after").waitFor();
    await graphDrawn(page);
    await settle(page);

    const [beforeTops = [], afterTops = []] = await page.getByTestId("before-after-card").evaluateAll((cards) =>
      cards.map((card) => [...card.querySelectorAll("[data-testid=metric-row]")].map((r) => r.getBoundingClientRect().top)),
    );
    expect(beforeTops.length).toBeGreaterThan(0);
    expect(afterTops.slice(0, beforeTops.length)).toEqual(beforeTops);
    await expect(page.getByTestId("before-after")).toHaveScreenshot("before-after.png");
  });

  test("keeps the before and after cards readable at the narrowest supported width", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
    await page.getByRole("tab", { name: "Proposed Solution" }).click();
    await page.getByTestId("before-after").waitFor();
    await settle(page);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expect(page.getByTestId("before-after")).toHaveScreenshot("before-after-narrow.png");
  });
});
