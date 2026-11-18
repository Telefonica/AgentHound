import { test, expect } from "@playwright/test";
import { mockAnalysesList } from "./mocks";
import { settle } from "./screen";

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
});

test.describe("Feedback screens", () => {
  test("shows the app-level 404 page for an unknown route", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await page.getByRole("heading", { name: "No results found" }).waitFor();
    await settle(page);

    await expect(page).toHaveScreenshot("not-found.png");
  });

  test("shows the desktop-only message instead of the app on a mobile viewport", async ({ page }) => {
    await mockAnalysesList(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/overview");
    await page.getByText("Desktop version").waitFor();
    await settle(page);

    await expect(page.getByText("Minimum 1024px wide")).toBeVisible();
    await expect(page).toHaveScreenshot("desktop-only-guard.png");
  });

  test("reads the desktop-only message in Spanish", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
    await mockAnalysesList(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/overview");
    await page.getByText("Versión de escritorio").waitFor();
    await settle(page);

    await expect(page).toHaveScreenshot("desktop-only-guard-es.png");
  });
});
