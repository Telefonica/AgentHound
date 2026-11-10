import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import {
  mockAnalyze,
  mockCapabilities,
  mockCreateAnalysis,
  mockEndpointError,
  mockOpsDestructiveAnalysis,
  OPS_DESTRUCTIVE_ID,
} from "./mocks";
import { canvas, fillAnalysisName, settle, showGraphedScreen, showWholeScreen } from "./screen";

const OPS_DESTRUCTIVE_YAML = path.join(__dirname, "../../../examples/03_ops_destructive/langgraph.yaml");

const EN = {
  newTest: "New test",
  analysisName: "Analysis name",
  analyze: "Analyze",
  parsed: "Architecture parsed",
  next: "Next",
  inference: "Agents and capabilities",
};

const ES: typeof EN = {
  newTest: "Nueva prueba",
  analysisName: "Nombre del análisis",
  analyze: "Analizar",
  parsed: "Arquitectura procesada",
  next: "Siguiente",
  inference: "Agentes y capacidades",
};

/** The elapsed time depends on the machine's speed, so it is masked out of the screenshots. */
const elapsedTime = (page: Page) => ({ mask: [page.getByText(/^Elapsed time /)] });

async function openNewTest(page: Page, copy = EN) {
  await page.goto("/tests/new");
  await page.getByRole("heading", { name: copy.newTest }).waitFor();
  await settle(page);
}

async function fillConfiguration(page: Page, copy = EN) {
  await fillAnalysisName(page, copy.analysisName, "IT Ops Assistant (risky)");
  await page.getByRole("button", { name: /^Framework/ }).click();
  await page.getByRole("option", { name: "LangGraph" }).click();
  await page.getByLabel("workflow.yaml", { exact: true }).setInputFiles(OPS_DESTRUCTIVE_YAML);
  await page.getByText("langgraph.yaml").waitFor();
}

async function analyzeArchitecture(page: Page, copy = EN) {
  await fillConfiguration(page, copy);
  await page.getByRole("button", { name: copy.analyze }).click();
  await page.getByRole("heading", { name: copy.parsed }).waitFor();
}

async function reachInference(page: Page, copy = EN) {
  await analyzeArchitecture(page, copy);
  await page.getByRole("button", { name: copy.next }).click();
  await page.getByRole("heading", { name: copy.inference }).waitFor();
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "agenthound-lang", value: "en", url: baseURL! }]);
  await mockOpsDestructiveAnalysis(page);
  await mockCreateAnalysis(page);
  await mockAnalyze(page);
  await mockCapabilities(page);
});

test.describe("New test screen", () => {
  test("starts on the configuration step with the CrewAI agents and tasks files", async ({ page }) => {
    await openNewTest(page);

    await expect(page.getByText("agents.yaml")).toBeVisible();
    await expect(page.getByText("tasks.yaml")).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyze" })).toBeDisabled();
    await expect(page).toHaveScreenshot("new-test-configuration.png");
  });

  test("reads in Spanish", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
    await openNewTest(page, ES);

    await expect(page).toHaveScreenshot("new-test-configuration-es.png");
  });

  test("flags the name once the field is left empty", async ({ page }) => {
    await openNewTest(page);

    const field = page.getByRole("textbox", { name: "Analysis name" });
    await expect(async () => {
      await field.focus();
      await field.blur();
      await expect(field).toHaveAttribute("aria-invalid", "true", { timeout: 1_000 });
    }).toPass();
    await expect(page).toHaveScreenshot("new-test-configuration-validation.png");
  });

  test("asks for a single workflow file for LangGraph and enables the analysis once filled", async ({ page }) => {
    await openNewTest(page);

    await fillConfiguration(page);
    await page.mouse.move(0, 0);

    await expect(page.getByRole("heading", { name: "IT Ops Assistant (risky)" })).toBeVisible();
    await expect(page.getByText("tasks.yaml")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Analyze" })).toBeEnabled();
    await expect(page).toHaveScreenshot("new-test-configuration-filled.png");
  });

  test("parses the architecture before moving on", async ({ page }) => {
    await openNewTest(page);

    await analyzeArchitecture(page);
    await page.mouse.move(0, 0);

    await expect(page.getByText("100%")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Analyzing" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
    await expect(page).toHaveScreenshot("new-test-processing-done.png", elapsedTime(page));
  });

  test("shows the parse failure with a retry", async ({ page }) => {
    await mockEndpointError(page, "POST", "/analyses");
    await openNewTest(page);

    await fillConfiguration(page);
    await page.getByRole("button", { name: "Analyze" }).click();
    // The step's own header (h2) names the failure; the page title (h1) stays the test name.
    await page.getByRole("heading", { name: "Parsing failed", level: 2 }).waitFor();
    await page.mouse.move(0, 0);

    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page).toHaveScreenshot("new-test-processing-error.png", elapsedTime(page));
  });

  test("lists every agent with the capabilities extracted from the YAML", async ({ page }) => {
    await openNewTest(page);

    await reachInference(page);
    await page.mouse.move(0, 0);

    await expect(page.getByTestId("coverage-warnings")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit agent" })).toHaveCount(2);
    await showWholeScreen(page);
    await expect(page).toHaveScreenshot("new-test-inference.png");
  });

  test("reads the agents step in Spanish", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "agenthound-lang", value: "es", url: baseURL! }]);
    await openNewTest(page, ES);

    await reachInference(page, ES);
    await page.mouse.move(0, 0);

    await showWholeScreen(page);
    await expect(page).toHaveScreenshot("new-test-inference-es.png");
  });

  test("edits an agent's capabilities in a drawer", async ({ page }) => {
    await openNewTest(page);
    await reachInference(page);

    await page.getByRole("button", { name: "Edit agent" }).first().click();
    const drawer = page.getByRole("dialog");
    await drawer.getByTestId("unchecked-verbs").first().waitFor();
    await page.mouse.move(0, 0);

    await expect(drawer.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page).toHaveScreenshot("new-test-agent-edit.png");
  });

  test("shows the results of the analysis as the last step", async ({ page }) => {
    await openNewTest(page);
    await reachInference(page);

    await page.getByRole("button", { name: "View Results" }).click();
    await canvas(page).locator(".react-flow__node").first().waitFor();

    await expect(page.getByRole("tab", { name: "Findings (17)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "View Results" })).toHaveCount(0);
    await showGraphedScreen(page);
    await expect(page).toHaveScreenshot("new-test-results.png");
  });

  test("stays on the agents step when the analysis fails", async ({ page }) => {
    await mockEndpointError(page, "POST", `/analyses/${OPS_DESTRUCTIVE_ID}/analyze`);
    await openNewTest(page);
    await reachInference(page);

    await page.getByRole("button", { name: "View Results" }).click();
    await page.getByText("Internal server error").waitFor();
    await page.mouse.move(0, 0);

    await expect(page.getByRole("heading", { name: "Agents and capabilities" })).toBeVisible();
    await showWholeScreen(page);
    await expect(page).toHaveScreenshot("new-test-analyze-error.png");
  });
});
