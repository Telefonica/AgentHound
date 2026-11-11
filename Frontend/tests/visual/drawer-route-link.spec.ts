import { test, expect } from "@playwright/test";
import { mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";
import { canvas, settle, WITHOUT_GLOW } from "./screen";

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Drawer route link", () => {
  test("highlights the route of a finding picked from a node drawer", async ({ page }) => {
    await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
    await page.getByTestId("prioritized-finding").first().waitFor();
    await settle(page);

    await canvas(page).locator('.react-flow__node[data-id="agent_ops_executor"]').click();
    const dialog = page.getByRole("dialog");
    const item = dialog.getByTestId("node-finding").first();
    await item.scrollIntoViewIfNeeded();
    await expect(item).toHaveScreenshot("drawer-with-route-link.png");

    await item.getByRole("button", { name: /Show route/ }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page);

    await expect(canvas(page).getByRole("status")).toBeVisible();
    await expect(canvas(page).locator(".ch-hl").first()).toBeVisible();
    await expect(canvas(page)).toHaveScreenshot("graph-route-from-drawer.png", WITHOUT_GLOW);
  });
});
