import { test, expect, type Locator, type Page } from "@playwright/test";
import { mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";
import { settle } from "./screen";

async function openResults(page: Page) {
  await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
  await page.getByTestId("prioritized-finding").first().waitFor();
  await settle(page);
}

const byLabel = (items: Locator, label: string) => items.filter({ hasText: new RegExp(`${label}(?!\\d)`) });

async function expectDistinct(items: Locator, labels: string[]) {
  for (const label of labels) await expect(byLabel(items, label)).toHaveCount(1);
  const texts = await Promise.all(labels.map((label) => byLabel(items, label).innerText()));
  expect(new Set(texts).size).toBe(labels.length);
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Finding identity", () => {
  test("tells apart findings of the same rule in a central node's drawer", async ({ page }) => {
    await openResults(page);

    await page.locator('[data-ch-canvas] .react-flow__node[data-id="agent_ops_executor"]').click();
    const items = page.getByRole("dialog").getByTestId("node-finding");

    await expect(items).toHaveCount(8);
    await expectDistinct(items, ["FH-011 #1", "FH-011 #2", "FH-019 #1", "FH-019 #2"]);
    for (const label of ["FH-011 #1", "FH-011 #2"]) {
      const item = byLabel(items, label);
      await item.scrollIntoViewIfNeeded();
      await expect(item).toHaveScreenshot(`drawer-${label.toLowerCase().replace(/\W+/g, "-")}.png`);
    }
  });

  test("tells apart resolved findings of the same rule", async ({ page }) => {
    await openResults(page);

    await page.getByRole("tab", { name: "Proposed Solution" }).click();
    await page.getByRole("button", { name: /Resolved/ }).click();
    const items = page.getByTestId("resolved-finding");

    await expectDistinct(items, ["FH-011 #1", "FH-011 #2"]);
    for (const label of ["FH-011 #1", "FH-011 #2"]) {
      const item = byLabel(items, label);
      await item.scrollIntoViewIfNeeded();
      await expect(item).toHaveScreenshot(`resolved-${label.toLowerCase().replace(/\W+/g, "-")}.png`);
    }
  });
});
