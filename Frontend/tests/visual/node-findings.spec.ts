import { test, expect, type Page } from "@playwright/test";
import { DATA_CODEEXEC_ID, mockDataCodeExecAnalysis } from "./mocks";

async function openResults(page: Page) {
  await page.goto(`/tests/${DATA_CODEEXEC_ID}`);
  await page.getByTestId("prioritized-finding").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

const canvas = (page: Page) => page.locator("[data-ch-canvas]");
const node = (page: Page, id: string) => canvas(page).locator(`.react-flow__node[data-id="${id}"]`);
const badge = (page: Page, id: string) => node(page, id).getByTestId("node-finding-badge");

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
  await mockDataCodeExecAnalysis(page);
});

test.describe("Node findings", () => {
  test("marks the node the top finding points at, even though no edge carries it", async ({ page }) => {
    await openResults(page);

    await expect(badge(page, "tool_python_interpreter")).toHaveText("9,8 · +2");
    await expect(badge(page, "tool_python_interpreter")).toHaveAttribute("data-severity", "critical");
    await expect(node(page, "tool_python_interpreter").getByTitle("3 hallazgos en este nodo · máx. 9,8")).toBeVisible();
    await expect(node(page, "tool_python_interpreter").getByText("3 hallazgos en este nodo · máx. 9,8")).toBeAttached();
    await expect(badge(page, "input_user_analysis_request")).toHaveText("7,6");
    await expect(badge(page, "agent_data_analyst")).toHaveAttribute("data-severity", "medium");
    await expect(badge(page, "tool_sales_database_read")).toHaveCount(0);
    await expect(badge(page, "tool_python_interpreter").locator("..")).toHaveAttribute("aria-hidden", "true");
    await expect(canvas(page).getByText("Hallazgos en nodos")).toBeVisible();
    await expect(canvas(page).getByTestId("legend-node-finding")).toHaveText("máx. · +NPuntuación máx. y cuántos más hay");
    await expect(canvas(page)).toHaveScreenshot("graph-node-findings.png");
  });

  test("highlights the node when its finding is selected", async ({ page }) => {
    await openResults(page);

    await page.getByTestId("prioritized-finding").filter({ hasText: /^FH-016/ }).click();

    await expect(canvas(page).getByRole("status")).toContainText("FH-016");
    await expect(node(page, "tool_python_interpreter")).toHaveClass(/ch-hl/);
    await expect(canvas(page)).toHaveScreenshot("graph-node-finding-selected.png");
  });

  test("keeps the legend heading when the isolated finding has no route", async ({ page }) => {
    await openResults(page);

    await page.getByTestId("prioritized-finding").filter({ hasText: /^FH-016/ }).click();
    await canvas(page).getByRole("button", { name: "Aislar ruta" }).click();

    await expect(canvas(page).locator(".react-flow__node")).toHaveCount(1);
    await expect(canvas(page).getByText("Severidad de la ruta")).toHaveCount(0);
    await expect(canvas(page).getByText("Hallazgos en nodos")).toBeVisible();
    await expect(canvas(page).getByTestId("legend-node-finding")).toBeVisible();
    await expect(canvas(page)).toHaveScreenshot("graph-node-finding-isolated.png");
  });

  test("keeps the node tags legible in dark mode", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("colorScheme", "dark"));
    await openResults(page);

    await expect(badge(page, "tool_python_interpreter")).toBeVisible();
    await expect(canvas(page)).toHaveScreenshot("graph-node-findings-dark.png");
  });

  test("drops the node tags in the proposed solution", async ({ page }) => {
    await openResults(page);

    await page.getByRole("tab", { name: "Solución propuesta" }).click();

    await expect(canvas(page).locator(".react-flow__node").first()).toBeVisible();
    await expect(canvas(page).getByTestId("node-finding-badge")).toHaveCount(0);
    await expect(canvas(page).getByTestId("legend-node-finding")).toHaveCount(0);
  });
});
