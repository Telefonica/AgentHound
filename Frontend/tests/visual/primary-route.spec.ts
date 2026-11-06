import { test, expect, type Page } from "@playwright/test";
import findings from "./fixtures/ops-destructive/findings.json" with { type: "json" };
import { API_ORIGIN, mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";
import { canvas, settle, WITHOUT_GLOW } from "./screen";

const primaryPath = (page: Page) => page.getByTestId("primary-path");
const flowingEdges = async (page: Page) =>
  (await canvas(page).locator(".react-flow__edge:has(path.ch-edge-flow)").evaluateAll((els) => els.map((el) => el.dataset.id ?? ""))).sort();

// Both FH-011 findings are critical with a 10.0 score; finding_001 reaches the
// delete tool, which concentrates more findings than the CRM update tool.
async function openResults(page: Page, order: "listed" | "reversed") {
  if (order === "reversed") {
    const [first, second, ...rest] = findings.findings;
    const body = JSON.stringify({ ...findings, findings: [second, first, ...rest] });
    await page.route(`${API_ORIGIN}/analyses/${OPS_DESTRUCTIVE_ID}/findings`, (route) =>
      route.request().method() === "OPTIONS"
        ? route.fallback()
        : route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*" }, contentType: "application/json", body }),
    );
  }
  await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
  await page.getByTestId("prioritized-finding").first().waitFor();
  await settle(page);
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Primary route", () => {
  // The label follows the numbering of the prioritized list, so it moves with the order.
  for (const [order, label] of [["listed", "FH-011 #1"], ["reversed", "FH-011 #2"]] as const) {
    test(`picks the route that concentrates the most risk when findings are ${order}`, async ({ page }) => {
      await openResults(page, order);

      await expect(primaryPath(page)).toContainText(label);
      await expect(canvas(page).getByText(`${label} primary route`)).toBeVisible();
      await expect(primaryPath(page)).toContainText("customer_records_delete");
      await expect(primaryPath(page)).not.toContainText("crm_records_update");
      expect(await flowingEdges(page)).toEqual(["edge_003", "edge_004", "edge_007", "edge_008"]);
      await expect(canvas(page)).toHaveScreenshot(`graph-primary-route-${order}.png`, WITHOUT_GLOW);
      await expect(primaryPath(page)).toHaveScreenshot(`primary-path-${order}.png`, WITHOUT_GLOW);

      await page.getByTestId("prioritized-finding-group").filter({ hasText: /^FH-011/ }).click();
      await page.getByTestId("prioritized-finding").filter({ hasText: new RegExp(`^${label}(?!\\d)`) }).click();
      await expect(canvas(page).getByRole("status")).toContainText(label);
      await expect(canvas(page).getByRole("status")).toContainText("customer_records_delete");
    });
  }
});
