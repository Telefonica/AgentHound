import { test, expect, type Page } from "@playwright/test";
import { mockOpsDestructiveAnalysis, OPS_DESTRUCTIVE_ID } from "./mocks";

const warnings = (page: Page) => page.getByTestId("coverage-warnings");
const header = (page: Page) => warnings(page).locator("[aria-expanded]");

async function openResults(page: Page) {
  await page.goto(`/tests/${OPS_DESTRUCTIVE_ID}`);
  await warnings(page).waitFor();
  await page.evaluate(() => document.fonts.ready);
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Coverage warnings", () => {
  test("flags a framework file's rules out of reach, collapsed", async ({ page }) => {
    await openResults(page);

    await expect(header(page)).toHaveAttribute("aria-expanded", "false");
    await expect(header(page)).toContainText("Cobertura del formato");
    await expect(header(page)).toContainText("12 reglas que el formato de este fichero no puede comprobar del todo");
    await expect(warnings(page)).toHaveScreenshot("coverage-warnings-collapsed.png");
  });

  test("lists the unreachable rules and what to declare for the rest", async ({ page }) => {
    await openResults(page);
    await header(page).click();

    await expect(warnings(page)).toContainText("No alcanzables desde este formato");
    await expect(warnings(page)).toContainText("Declara recipient_type");
    await expect(warnings(page)).toHaveScreenshot("coverage-warnings-expanded.png");
  });

  test("reads in English", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
    await openResults(page);
    await header(page).click();

    await expect(warnings(page)).toContainText("Declare recipient_type");
    await expect(warnings(page)).toHaveScreenshot("coverage-warnings-expanded-en.png");
  });

  test("reads in dark mode", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("colorScheme", "dark"));
    await openResults(page);
    await header(page).click();

    await expect(warnings(page)).toHaveScreenshot("coverage-warnings-expanded-dark.png");
  });
});
