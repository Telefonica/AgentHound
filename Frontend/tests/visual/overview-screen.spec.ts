import { test, expect, type Page } from "@playwright/test";
import {
  API_ORIGIN,
  analysisItem,
  mockAnalysesList,
  mockAnalysesListError,
  mockDeleteAnalysis,
  mockOpsDestructiveAnalysis,
  OPS_DESTRUCTIVE_ID,
} from "./mocks";
import { settle, showWholeScreen } from "./screen";

const MANY = Array.from({ length: 12 }, (_, i) =>
  analysisItem({
    analysis_id: `analysis-${i + 1}`,
    name: `Agent architecture ${i + 1}`,
    uploaded_at: `2026-10-${String(30 - i).padStart(2, "0")}T09:00:00+00:00`,
  }),
);

async function openOverview(page: Page, ready: string) {
  await page.goto("/overview");
  await page.getByText(ready, { exact: true }).first().waitFor();
  await settle(page);
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
});

test.describe("Overview screen", () => {
  test("lists every test with its KPIs and severity", async ({ page }) => {
    await mockAnalysesList(page);
    await openOverview(page, "IT Ops Assistant (risky)");

    await expect(page.getByText("Total tests")).toBeVisible();
    await expect(page.getByText("Clean", { exact: true })).toBeVisible();
    await expect(page.getByText("langgraph · Oct 23, 2026")).toBeVisible();
    await showWholeScreen(page);
    await expect(page).toHaveScreenshot("overview-list.png");
  });

  test("reads in Spanish", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
    await mockAnalysesList(page);
    await openOverview(page, "IT Ops Assistant (risky)");

    await expect(page.getByText("Pruebas totales")).toBeVisible();
    await showWholeScreen(page);
    await expect(page).toHaveScreenshot("overview-list-es.png");
  });

  test("pages through more tests than fit on one page", async ({ page }) => {
    await mockAnalysesList(page, MANY);
    await openOverview(page, "Agent architecture 1");
    await expect(page.getByText(/^Agent architecture \d+$/)).toHaveCount(5);

    await page.getByRole("button", { name: "Page 2" }).click();
    await page.mouse.move(0, 0);

    await expect(page.getByText("Agent architecture 6", { exact: true })).toBeVisible();
    await expect(page.getByText("Agent architecture 1", { exact: true })).toHaveCount(0);
    await showWholeScreen(page);
    await expect(page).toHaveScreenshot("overview-paginated.png");
  });

  test("invites to create the first test when there are none", async ({ page }) => {
    await mockAnalysesList(page, []);
    await openOverview(page, "Create your first test");

    await expect(page.getByText("Total tests")).toBeVisible();
    await expect(page).toHaveScreenshot("overview-empty.png");
  });

  test("reads the empty state in Spanish", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
    await mockAnalysesList(page, []);
    await openOverview(page, "Crea tu primera prueba");

    await expect(page).toHaveScreenshot("overview-empty-es.png");
  });

  test("offers a retry when the tests can't be loaded", async ({ page }) => {
    await mockAnalysesListError(page);
    await openOverview(page, "Could not load your tests.");

    await expect(page.getByText("Total tests")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page).toHaveScreenshot("overview-error.png");
  });

  test("lists the tests once a retry succeeds", async ({ page }) => {
    await mockAnalysesListError(page);
    await openOverview(page, "Could not load your tests.");
    await mockAnalysesList(page);

    await page.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByText("IT Ops Assistant (risky)")).toBeVisible();
  });

  test("shows a spinner while the tests load", async ({ page }) => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await mockAnalysesList(page);
    await page.route(`${API_ORIGIN}/analyses`, async (route) => {
      if (route.request().method() !== "OPTIONS") await released;
      await route.fallback();
    });

    await page.goto("/overview");
    await page.getByRole("heading", { name: "Overview" }).waitFor();
    await settle(page);

    await expect(page.getByText("Total tests")).toHaveCount(0);
    await expect(page).toHaveScreenshot("overview-loading.png");
    release();
    await expect(page.getByText("IT Ops Assistant (risky)")).toBeVisible();
  });

  test("asks for confirmation before deleting a test", async ({ page }) => {
    await mockAnalysesList(page);
    await openOverview(page, "IT Ops Assistant (risky)");

    await page.getByRole("button", { name: "Delete IT Ops Assistant (risky)" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.mouse.move(0, 0);

    await expect(dialog).toContainText("Delete \"IT Ops Assistant (risky)\"? This action can't be undone.");
    await expect(page).toHaveScreenshot("overview-delete-dialog.png");
  });

  test("drops the row once the deletion is confirmed", async ({ page }) => {
    await mockAnalysesList(page);
    await mockDeleteAnalysis(page, OPS_DESTRUCTIVE_ID);
    await openOverview(page, "IT Ops Assistant (risky)");

    await page.getByRole("button", { name: "Delete IT Ops Assistant (risky)" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("IT Ops Assistant (risky)")).toHaveCount(0);
    await expect(page.getByText("Data Analysis Assistant (risky)")).toBeVisible();
  });

  test("opens a test's results from its row", async ({ page }) => {
    await mockOpsDestructiveAnalysis(page);
    await mockAnalysesList(page);
    await openOverview(page, "IT Ops Assistant (risky)");

    await page.getByRole("button", { name: /^IT Ops Assistant \(risky\)/ }).click();

    await expect(page).toHaveURL(`/tests/${OPS_DESTRUCTIVE_ID}`);
    await expect(page.getByRole("button", { name: "Back to overview" })).toBeVisible();
  });
});
