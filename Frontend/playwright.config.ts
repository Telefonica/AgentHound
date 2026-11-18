import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 20,
      threshold: 0.02,
    },
  },

  use: {
    baseURL: "http://localhost:3013",
    locale: "en-US",
    timezoneId: "Europe/Madrid",
    contextOptions: { reducedMotion: "reduce" },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Mistica draws some icons (the Stepper's check, feedback icons) with SVG
        // <animate>, which reducedMotion and Playwright's animation freezing don't
        // stop. Mistica turns them off when the user agent says "acceptance-test"
        // (see @telefonica/mistica/doc/testing.md), so screenshots never catch
        // them halfway.
        userAgent: `${devices["Desktop Chrome"].userAgent} acceptance-test`,
        viewport: { width: 1440, height: 900 },
      },
    },
  ],

  webServer: {
    // Dedicated port so an already running local server is never reused.
    command: "next build && next start --port 3013",
    env: { NEXT_DISABLE_STANDALONE: "1", NEXT_DIST_DIR: ".next-visual" },
    url: "http://localhost:3013",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
