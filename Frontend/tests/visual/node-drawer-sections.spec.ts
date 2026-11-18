import { test, expect, type Page } from "@playwright/test";
import { mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";
import { canvas, settle } from "./screen";

const dialog = (page: Page) => page.getByRole("dialog");

async function openNode(page: Page, id: string) {
  await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
  await page.getByTestId("prioritized-finding").first().waitFor();
  await settle(page);
  await canvas(page).locator(`.react-flow__node[data-id="${id}"]`).click();
  await dialog(page).waitFor();
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Node drawer sections", () => {
  test("splits the node's own findings from the routes through it", async ({ page }) => {
    await openNode(page, "tool_customer_records_delete");

    const own = dialog(page).getByTestId("node-own-findings");
    const through = dialog(page).getByTestId("node-through-findings");
    await expect(own).toContainText("Findings on this node");
    await expect(through).toContainText("Attack paths through this node");
    await own.scrollIntoViewIfNeeded();
    await expect(own).toHaveScreenshot("node-drawer-own-findings.png");
    await through.scrollIntoViewIfNeeded();
    await expect(through.getByTestId("node-finding").first()).toBeVisible();
    await expect(through).toHaveScreenshot("node-drawer-through-findings.png");
  });

  test("lists the own findings before the routes through the node", async ({ page }) => {
    await openNode(page, "tool_customer_records_delete");

    const own = await dialog(page).getByTestId("node-own-findings").boundingBox();
    const through = await dialog(page).getByTestId("node-through-findings").boundingBox();
    expect(own!.y).toBeLessThan(through!.y);
  });
});
