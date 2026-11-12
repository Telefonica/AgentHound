import { test, expect, type Page } from "@playwright/test";
import { DATA_CODEEXEC_ID, mockDataCodeExecAnalysis } from "./mocks";
import { canvas, settle, WITHOUT_GLOW } from "./screen";

async function openResults(page: Page) {
  await page.goto(`/tests/${DATA_CODEEXEC_ID}`);
  await page.getByTestId("prioritized-finding").first().waitFor();
  await settle(page);
}

const node = (page: Page, id: string) => canvas(page).locator(`.react-flow__node[data-id="${id}"]`);
const badge = (page: Page, id: string) => node(page, id).getByTestId("node-finding-badge");

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
  await mockDataCodeExecAnalysis(page);
});

test.describe("Node findings", () => {
  test("marks the node the top finding points at, even though no edge carries it", async ({ page }) => {
    await openResults(page);

    await expect(badge(page, "tool_python_interpreter")).toHaveText("9.8");
    await expect(node(page, "tool_python_interpreter").getByTestId("node-finding-count")).toHaveText("3 findings");
    await expect(badge(page, "tool_python_interpreter")).toHaveAttribute("data-severity", "critical");
    await expect(node(page, "tool_python_interpreter").getByTitle("3 findings on this node · max 9.8")).toBeVisible();
    await expect(node(page, "tool_python_interpreter").getByText("3 findings on this node · max 9.8")).toBeAttached();
    await expect(badge(page, "input_user_analysis_request")).toHaveText("7.6");
    await expect(badge(page, "agent_data_analyst")).toHaveAttribute("data-severity", "medium");
    await expect(badge(page, "tool_sales_database_read")).toHaveCount(0);
    await expect(badge(page, "tool_python_interpreter").locator("..")).toHaveAttribute("aria-hidden", "true");
    await expect(canvas(page).getByText("Node findings")).toBeVisible();
    await expect(canvas(page).getByTestId("legend-node-finding")).toHaveText("maxN findingsTop score and number of findings");
    await expect(canvas(page)).toHaveScreenshot("graph-node-findings.png", WITHOUT_GLOW);
  });

  test("highlights the node when its finding is selected", async ({ page }) => {
    await openResults(page);

    await page.getByTestId("prioritized-finding").filter({ hasText: /^FH-016/ }).click();

    await expect(canvas(page).getByRole("status")).toContainText("FH-016");
    await expect(node(page, "tool_python_interpreter")).toHaveClass(/ch-hl/);
    await expect(canvas(page)).toHaveScreenshot("graph-node-finding-selected.png", WITHOUT_GLOW);
  });

  test("keeps the legend heading when the isolated finding has no route", async ({ page }) => {
    await openResults(page);

    await page.getByTestId("prioritized-finding").filter({ hasText: /^FH-016/ }).click();
    await canvas(page).getByRole("button", { name: "Isolate route" }).click();

    await expect(canvas(page).locator(".react-flow__node")).toHaveCount(1);
    await expect(canvas(page).getByText("Path severity")).toHaveCount(0);
    await expect(canvas(page).getByText("Node findings")).toBeVisible();
    await expect(canvas(page).getByTestId("legend-node-finding")).toBeVisible();
    await expect(canvas(page)).toHaveScreenshot("graph-node-finding-isolated.png", WITHOUT_GLOW);
  });

  test("keeps the node tags legible in dark mode", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("colorScheme", "dark"));
    await openResults(page);

    await expect(badge(page, "tool_python_interpreter")).toBeVisible();
    await expect(canvas(page)).toHaveScreenshot("graph-node-findings-dark.png", WITHOUT_GLOW);
  });

  test("drops the node tags in the proposed solution", async ({ page }) => {
    await openResults(page);

    await page.getByRole("tab", { name: "Proposed Solution" }).click();

    await expect(canvas(page).locator(".react-flow__node").first()).toBeVisible();
    await expect(canvas(page).getByTestId("node-finding-badge")).toHaveCount(0);
    await expect(canvas(page).getByTestId("legend-node-finding")).toHaveCount(0);
  });
});
