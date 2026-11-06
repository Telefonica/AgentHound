import { expect, type Page } from "@playwright/test";
import path from "node:path";

const SCROLLABLE = ["auto", "scroll"];

export const canvas = (page: Page) => page.locator("[data-ch-canvas]");

const viewportTransform = (page: Page) =>
  canvas(page).locator(".react-flow__viewport").evaluate((el) => getComputedStyle(el).transform);

export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

export async function fillAnalysisName(page: Page, label: string, name: string) {
  await expect(async () => {
    await page.getByRole("textbox", { name: label }).fill(name);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

export async function settledViewport(page: Page) {
  let previous = "";
  await expect.poll(async () => previous === (previous = await viewportTransform(page)), { intervals: [250] }).toBe(true);
}

function nextFrame(page: Page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function contentHeight(page: Page) {
  return page.evaluate(
    (scrollable) =>
      Math.max(
        document.documentElement.scrollHeight,
        ...Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .filter((el) => scrollable.includes(getComputedStyle(el).overflowY))
          .map((el) => el.scrollHeight),
      ),
    SCROLLABLE,
  );
}

export async function showWholeScreen(page: Page) {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: await contentHeight(page) });
  await page.evaluate((scrollable) => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (scrollable.includes(getComputedStyle(el).overflowY)) el.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }, SCROLLABLE);
  await nextFrame(page);
}

export async function showGraphedScreen(page: Page) {
  await settledViewport(page);
  await showWholeScreen(page);
  await settledViewport(page);
  await page.mouse.move(0, 0);
}

export const WITHOUT_GLOW = { stylePath: path.join(__dirname, "without-glow.css") };
