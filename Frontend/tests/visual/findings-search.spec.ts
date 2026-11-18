import { test, expect, type Page } from "@playwright/test";
import { mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";
import { settle } from "./screen";

const box = (page: Page) => page.getByTestId("prioritized-findings");
const search = (page: Page) => box(page).getByLabel("Search findings");
const rows = (page: Page) => box(page).getByTestId("prioritized-finding");

async function openResults(page: Page) {
  await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
  await rows(page).first().waitFor();
  await settle(page);
  await box(page).scrollIntoViewIfNeeded();
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Prioritized findings search", () => {
  test("shows the search and the severity filters above the list", async ({ page }) => {
    await openResults(page);
    await expect(page.getByTestId("findings-match-count")).toHaveCount(0);
    await expect(box(page)).toHaveScreenshot("prioritized-default.png");
  });

  test("finds an FH by typing it, even past the visible patterns", async ({ page }) => {
    await openResults(page);
    await search(page).fill("FH-019");
    await expect(page.getByTestId("findings-match-count")).toContainText(" of ");
    await expect(rows(page).first()).toContainText("FH-019");
    await expect(box(page)).toHaveScreenshot("prioritized-search-fh.png");
  });

  test("narrows by severity", async ({ page }) => {
    await openResults(page);
    await page.getByTestId("severity-chip-critical").click();
    await expect(page.getByTestId("findings-match-count")).toContainText(" of ");
    await expect(box(page)).toHaveScreenshot("prioritized-severity-critical.png");
  });

  test("offers a way back when nothing matches", async ({ page }) => {
    await openResults(page);
    await search(page).fill("zzzz-no-such-finding");
    await expect(page.getByTestId("findings-empty")).toBeVisible();
    await expect(box(page)).toHaveScreenshot("prioritized-empty.png");
    await box(page).getByRole("button", { name: "Clear search and filters" }).click();
    await expect(page.getByTestId("findings-empty")).toHaveCount(0);
    await expect(search(page)).toHaveValue("");
  });
});
