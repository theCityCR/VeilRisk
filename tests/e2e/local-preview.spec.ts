import { expect, test } from "@playwright/test";
import { defaultPolicy, policyVectors } from "../fixtures/policy-vectors.mjs";

const allocationLabels = {
  cash: "Cash",
  bonds: "Bonds",
  equities: "Equities",
  speculative: "Speculative",
};
const browserIssues = new WeakMap<import("@playwright/test").Page, string[]>();

test.afterEach(async ({ page }) => {
  expect(browserIssues.get(page) ?? []).toEqual([]);
});

async function openInteractiveApp(page: import("@playwright/test").Page) {
  const issues: string[] = [];
  browserIssues.set(page, issues);
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(message.text());
  });
  page.on("pageerror", (error) => issues.push(error.message));
  page.on("requestfailed", (request) => issues.push(`Request failed: ${request.method()} ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 500) issues.push(`Unexpected response: ${response.status()} ${response.url()}`);
  });

  await page.goto("/");
  try {
    await page.waitForFunction(() => typeof document.querySelector<HTMLButtonElement>(".prove-button")?.onclick === "function");
  } catch {
    throw new Error(`The application did not become interactive: ${issues.join(" | ") || "no browser error was reported"}`);
  }
  expect(issues).toEqual([]);
}

test("an invalid portfolio fails locally without producing a public artifact", async ({ page }) => {
  const outboundSubmissions: string[] = [];
  page.on("request", (request) => {
    if (!(["GET", "HEAD"] as string[]).includes(request.method())) {
      outboundSubmissions.push(`${request.method()} ${request.url()}`);
    }
  });

  await openInteractiveApp(page);
  await page.getByRole("button", { name: "Risky demo" }).click();

  const privatePanel = page.locator(".private-panel");
  const publicPanel = page.locator(".public-panel");

  await expect(privatePanel).toContainText("Needs changes");
  await expect(privatePanel).toContainText("Speculative exposure");
  await page.getByRole("button", { name: "Create local compliance preview" }).click();

  await expect(page.getByRole("alert")).toContainText("failed locally");
  await expect(publicPanel).toContainText("No local preview");
  await expect(publicPanel).not.toContainText("Speculative exposure");
  await expect(publicPanel).not.toContainText("Policy not satisfied");
  await expect(page).not.toHaveURL(/vr_|allocation|portfolio/i);
  expect(outboundSubmissions).toEqual([]);
});

test("a compliant portfolio creates only an explicitly local preview", async ({ page }) => {
  await openInteractiveApp(page);
  await page.getByRole("button", { name: "Create local compliance preview" }).click();

  const publicPanel = page.locator(".public-panel");
  await expect(publicPanel).toContainText("Local preview · not verified on-chain");
  await expect(publicPanel).toContainText("Compliant locally");
  await expect(publicPanel).toContainText("Not submitted");
  await expect(publicPanel).not.toContainText("Midnight Preprod");
  await expect(publicPanel).not.toContainText(/vr_[a-z0-9]+/i);
  await expect(page.getByText("Local prototype")).toBeVisible();
});

test("editing private input clears a stale local preview", async ({ page }) => {
  await openInteractiveApp(page);
  await page.getByRole("button", { name: "Create local compliance preview" }).click();
  await expect(page.locator(".public-panel")).toContainText("Compliant locally");

  await page.getByRole("slider", { name: "Cash" }).fill("1600");

  await expect(page.locator(".public-panel")).toContainText("No local preview");
  await expect(page.locator(".private-panel")).toContainText("Needs changes");
});

test("changing the public policy clears a stale local preview", async ({ page }) => {
  await openInteractiveApp(page);
  await page.getByRole("button", { name: "Create local compliance preview" }).click();
  await expect(page.locator(".public-panel")).toContainText("Compliant locally");

  await page.getByLabel("Speculative cap").selectOption("1000");

  await expect(page.locator(".public-panel")).toContainText("No local preview");
});

test("shared default-policy boundary vectors match the browser result", async ({ page }) => {
  await openInteractiveApp(page);

  for (const vector of policyVectors.filter(({ policy }) => policy === defaultPolicy)) {
    for (const [bucket, value] of Object.entries(vector.allocation)) {
      await page.getByRole("slider", {
        name: allocationLabels[bucket as keyof typeof allocationLabels],
      }).fill(String(value));
    }

    const privatePanel = page.locator(".private-panel");
    await expect(privatePanel).toContainText(vector.passed ? "Ready" : "Needs changes");
    await page.getByRole("button", { name: "Create local compliance preview" }).click();

    if (vector.passed) {
      await expect(page.locator(".public-panel")).toContainText("Compliant locally");
    } else {
      await expect(page.getByRole("alert")).toContainText("failed locally");
      await expect(page.locator(".public-panel")).toContainText("No local preview");
    }
  }
});

test("both presets work with keyboard controls and the viewport does not overflow", async ({ page }) => {
  await openInteractiveApp(page);

  const riskyPreset = page.getByRole("button", { name: "Risky demo" });
  await riskyPreset.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".private-panel")).toContainText("Needs changes");

  const balancedPreset = page.getByRole("button", { name: "Balanced demo" });
  await balancedPreset.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".private-panel")).toContainText("Ready");

  const cash = page.getByRole("slider", { name: "Cash" });
  await cash.focus();
  await page.keyboard.press("ArrowRight");
  await expect(cash).toHaveValue("1501");
  await page.keyboard.press("ArrowLeft");

  const previewButton = page.getByRole("button", { name: "Create local compliance preview" });
  await previewButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".public-panel")).toContainText("Compliant locally");

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
});

test("refresh and a fresh browser session restore no private or preview state", async ({ page, context }) => {
  await openInteractiveApp(page);
  await page.getByRole("slider", { name: "Cash" }).fill("1501");
  await page.getByRole("slider", { name: "Bonds" }).fill("2499");
  await page.getByRole("button", { name: "Create local compliance preview" }).click();
  await expect(page.locator(".public-panel")).toContainText("Compliant locally");

  await page.reload();
  await page.waitForFunction(() => typeof document.querySelector<HTMLButtonElement>(".prove-button")?.onclick === "function");
  await expect(page.getByRole("slider", { name: "Cash" })).toHaveValue("1500");
  await expect(page.locator(".public-panel")).toContainText("No local preview");

  const stored = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(stored).toEqual({ local: {}, session: {} });

  const freshPage = await context.newPage();
  await openInteractiveApp(freshPage);
  await expect(freshPage.getByRole("slider", { name: "Cash" })).toHaveValue("1500");
  await expect(freshPage.locator(".public-panel")).toContainText("No local preview");
  await freshPage.close();
});

test("private allocations stay out of URLs, storage, and the shareable panel", async ({ page }) => {
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  await openInteractiveApp(page);

  await page.getByRole("slider", { name: "Cash" }).fill("1501");
  await page.getByRole("slider", { name: "Bonds" }).fill("2499");
  await page.getByRole("button", { name: "Create local compliance preview" }).click();

  const publicText = await page.locator(".public-panel").innerText();
  const storageText = await page.evaluate(() => JSON.stringify({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  for (const prohibitedValue of ["1501", "2499", "15.01%", "24.99%"] ) {
    expect(publicText).not.toContain(prohibitedValue);
    expect(page.url()).not.toContain(prohibitedValue);
    expect(storageText).not.toContain(prohibitedValue);
    expect(requestedUrls.join("\n")).not.toContain(prohibitedValue);
  }
});
