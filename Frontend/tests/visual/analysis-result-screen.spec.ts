import { test, expect, type Page } from "@playwright/test";
import {
  DATA_CODEEXEC_ID,
  mockDataCodeExecAnalysis,
  mockEndpointError,
  mockOpsDestructiveAnalysis,
  OPS_DESTRUCTIVE_ID,
} from "./mocks";
import { canvas, settle, showGraphedScreen } from "./screen";

async function openResult(page: Page, id: string, query = "") {
  await page.goto(`/tests/${id}${query}`);
  await canvas(page).locator(".react-flow__node").first().waitFor();
  await settle(page);
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
});

test.describe("Analysis result screen", () => {
  test("shows the findings of a stored analysis with its graph, metrics and accordion", async ({ page }) => {
    await mockOpsDestructiveAnalysis(page);
    await openResult(page, OPS_DESTRUCTIVE_ID);

    await expect(page.getByRole("heading", { name: "IT Ops Assistant (risky)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Findings (17)" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Back to overview" })).toBeVisible();
    await showGraphedScreen(page);
    await expect(page).toHaveScreenshot("analysis-findings.png");
  });

  test("reads in Spanish", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
    await mockOpsDestructiveAnalysis(page);
    await openResult(page, OPS_DESTRUCTIVE_ID);

    await expect(page.getByRole("tab", { name: "Hallazgos (17)" })).toBeVisible();
    await showGraphedScreen(page);
    await expect(page).toHaveScreenshot("analysis-findings-es.png");
  });

  test("shows the findings of another framework file's analysis", async ({ page }) => {
    await mockDataCodeExecAnalysis(page);
    await openResult(page, DATA_CODEEXEC_ID);

    await expect(page.getByRole("heading", { name: "Data Analysis Assistant (risky)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Findings (13)" })).toBeVisible();
    await showGraphedScreen(page);
    await expect(page).toHaveScreenshot("analysis-findings-data-codeexec.png");
  });

  test("shows the proposed solution with the mitigated graph and the before and after", async ({ page }) => {
    await mockOpsDestructiveAnalysis(page);
    await openResult(page, OPS_DESTRUCTIVE_ID);

    await page.getByRole("tab", { name: "Proposed Solution" }).click();

    await expect(page.getByRole("tab", { name: "Proposed Solution" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("coverage-warnings")).toHaveCount(0);
    await showGraphedScreen(page);
    await expect(page).toHaveScreenshot("analysis-solution.png");
  });

  test("reads the proposed solution in Spanish", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
    await mockOpsDestructiveAnalysis(page);
    await openResult(page, OPS_DESTRUCTIVE_ID);

    await page.getByRole("tab", { name: "Solución propuesta" }).click();

    await showGraphedScreen(page);
    await expect(page).toHaveScreenshot("analysis-solution-es.png");
  });

  test("keeps the findings usable but flags the solution when the simulation fails", async ({ page }) => {
    await mockOpsDestructiveAnalysis(page);
    await mockEndpointError(page, "POST", `/analyses/${OPS_DESTRUCTIVE_ID}/simulate-controls`);
    await openResult(page, OPS_DESTRUCTIVE_ID);

    await page.getByRole("tab", { name: "Proposed Solution" }).click();
    await page.mouse.move(0, 0);

    await expect(page.getByText("Couldn't load the content. Please try again.")).toBeVisible();
    await expect(canvas(page)).toHaveCount(0);
    await expect(page).toHaveScreenshot("analysis-solution-unavailable.png");
  });

  test("offers a retry when the analysis can't be loaded", async ({ page }) => {
    await mockOpsDestructiveAnalysis(page);
    await mockEndpointError(page, "GET", `/analyses/${OPS_DESTRUCTIVE_ID}/findings`);
    await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
    await page.getByText("Could not load this test.").waitFor();
    await settle(page);

    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page).toHaveScreenshot("analysis-error.png");
  });

  test("returns to the results dashboard when opened from it", async ({ page }) => {
    await mockOpsDestructiveAnalysis(page);
    await openResult(page, OPS_DESTRUCTIVE_ID, "?from=results");

    await expect(page.getByRole("button", { name: "Back to results" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to overview" })).toHaveCount(0);
  });
});
