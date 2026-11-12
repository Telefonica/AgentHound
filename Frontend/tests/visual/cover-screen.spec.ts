import { test, expect } from "@playwright/test";
import { mockAnalysesList } from "./mocks";
import { settle } from "./screen";

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
});

test.describe("Cover screen", () => {
  test("introduces the product with its call to action", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("heading", { name: "Analyze your agent model" }).waitFor();
    await settle(page);

    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(page).toHaveScreenshot("cover.png");
  });

  test("reads in Spanish", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
    await page.goto("/");
    await page.getByRole("heading", { name: "Analiza el modelo de tu agente" }).waitFor();
    await settle(page);

    await expect(page).toHaveScreenshot("cover-es.png");
  });

  test("opens the overview from the call to action", async ({ page }) => {
    await mockAnalysesList(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Start" }).click();

    await expect(page).toHaveURL("/overview");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  });
});
