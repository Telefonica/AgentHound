import { test, expect, type Page } from "@playwright/test";
import capabilities from "./fixtures/capabilities.json" with { type: "json" };
import analysis from "./fixtures/ops-destructive/analysis.json" with { type: "json" };
import { API_ORIGIN, mockOpsDestructiveAnalysis } from "./mocks";
import { fillAnalysisName, settle } from "./screen";

const CORS = { "Access-Control-Allow-Origin": "*" };
const YAML = { mimeType: "application/x-yaml", buffer: Buffer.from("agents: {}\n") };

const toolsRow = (page: Page) => page.getByRole("dialog").getByTestId("catalog-row-usesTools");

async function openAgentEditor(page: Page) {
  await page.route(`${API_ORIGIN}/analyses`, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 200,
          headers: CORS,
          contentType: "application/json",
          body: JSON.stringify({ analysis_id: analysis.analysis_id, status: "parsed", name: analysis.name, summary: analysis.summary, warnings: [] }),
        })
      : route.fallback(),
  );
  await page.route(`${API_ORIGIN}/capabilities`, (route) =>
    route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(capabilities) }),
  );
  await page.goto("/tests/new");
  await fillAnalysisName(page, "Analysis name", "IT Ops");
  const uploads = page.locator("input[type=file]");
  await uploads.nth(0).setInputFiles({ name: "agents.yaml", ...YAML });
  await uploads.nth(0).setInputFiles({ name: "tasks.yaml", ...YAML });
  await page.getByRole("button", { name: "Analyze" }).click();
  await page.getByText("Capability extraction complete").waitFor();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Edit agent" }).first().click();
  await page.getByRole("dialog").locator("[data-testid=unchecked-verbs]").first().waitFor();
  await settle(page);
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
});

test.describe("Capability rules in the agent editor", () => {
  test("sets apart the catalog verbs no rule looks at", async ({ page }) => {
    await openAgentEditor(page);

    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-testid=unchecked-verbs]").filter({ hasText: "summarize" })).toHaveCount(1);
    await expect(dialog.locator("[data-testid=unchecked-verbs]").filter({ hasText: /\bread\b/ })).toHaveCount(0);
    await expect(toolsRow(page)).toHaveScreenshot("catalog-tools-row.png");
  });

  test("names the rules that check a verb on hover", async ({ page }) => {
    await openAgentEditor(page);

    await page.getByRole("dialog").getByRole("button", { name: "invokeTool", exact: true }).hover();

    await expect(page.getByRole("tooltip")).toContainText("Checked by FH-");
  });

  test("names the rules when adding a verb some rule looks at", async ({ page }) => {
    await openAgentEditor(page);

    await page.getByRole("dialog").getByRole("button", { name: "invokeTool", exact: true }).click();

    await expect(page.getByRole("dialog")).toContainText("Checked by FH-");
  });

  test("warns when adding a verb no rule looks at", async ({ page }) => {
    await openAgentEditor(page);

    await page.getByRole("dialog").getByRole("button", { name: "summarize", exact: true }).click();

    await expect(page.getByRole("dialog")).toContainText("No rule looks at the verb \"summarize\"");
  });
});

test.describe("Capability rules in the agent editor on a touch screen", () => {
  test.use({ viewport: { width: 1366, height: 1024 }, hasTouch: true, isMobile: true });

  test("names the rules when a verb is tapped instead of opening a tooltip", async ({ page }) => {
    await openAgentEditor(page);

    await page.getByRole("dialog").getByRole("button", { name: "invokeTool", exact: true }).tap();

    await expect(page.getByRole("dialog")).toContainText("Checked by FH-");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });
});
