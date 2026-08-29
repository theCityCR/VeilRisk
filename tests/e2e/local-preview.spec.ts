import { expect, test } from "@playwright/test";
import { defaultPolicy, policyVectors } from "../fixtures/policy-vectors.mjs";

const allocationLabels = {
  cash: "Cash",
  bonds: "Bonds",
  equities: "Equities",
  speculative: "Speculative",
};
const browserIssues = new WeakMap<import("@playwright/test").Page, string[]>();

async function attemptDeploymentWithoutLace(page: import("@playwright/test").Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await page.getByRole("alert").isVisible()) return;
    const button = page.getByRole("button", { name: /^(Connect Lace and deploy|Retry deployment)$/ });
    await button.waitFor();
    const deploymentReloaded = page.waitForEvent("framenavigated").then(() => "reloaded" as const);
    const deploymentUnavailable = page.getByRole("alert").waitFor({ timeout: 30_000 }).then(() => "failed" as const);
    await button.click();
    if (await Promise.race([deploymentReloaded, deploymentUnavailable]) === "failed") return;
  }
  throw new Error("The deployment page kept reloading while preparing the Midnight SDK.");
}

test.beforeAll(async ({ browser }) => {
  // The Vinext development server performs one full reload when the lazily
  // loaded Midnight SDK is transformed for the first time. Warm that module
  // before assertions begin so the parallel dependency optimizer cannot
  // interrupt a user interaction under test.
  const page = await browser.newPage();
  await page.goto("/");
  await page.waitForFunction(() => typeof document.querySelector<HTMLButtonElement>(".prove-button")?.onclick === "function");

  const reloaded = page.waitForEvent("framenavigated").then(() => true, () => false);
  const unavailable = page.getByRole("alert").waitFor().then(() => false, () => false);
  await page.getByRole("button", { name: "Connect Lace" }).click();
  if (await Promise.race([reloaded, unavailable])) {
    await page.waitForFunction(() => typeof document.querySelector<HTMLButtonElement>(".prove-button")?.onclick === "function");
    await page.getByRole("button", { name: "Connect Lace" }).click();
    await page.getByRole("alert").waitFor();
  }

  await page.goto("/deploy");
  await attemptDeploymentWithoutLace(page);
  await page.close();
});

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

async function openDeploymentPage(page: import("@playwright/test").Page) {
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

  await page.goto("/deploy");
  await page.getByRole("button", { name: "Connect Lace and deploy" }).waitFor();
  expect(issues).toEqual([]);
}

async function installMockLace(
  page: import("@playwright/test").Page,
  options: { rejectFirstConnection?: boolean; rejectFirstProofProvider?: boolean } = {},
) {
  await page.addInitScript(({ rejectFirstConnection, rejectFirstProofProvider }) => {
    const runtime = window as unknown as {
      __laceConnected: boolean;
      __laceConnectAttempts: number;
      __laceProofAttempts: number;
      midnight: Record<string, unknown>;
    };
    runtime.__laceConnected = true;
    runtime.__laceConnectAttempts = 0;
    runtime.__laceProofAttempts = 0;

    const connectedApi = {
      getConnectionStatus: async () => runtime.__laceConnected
        ? { status: "connected", networkId: "preprod" }
        : { status: "disconnected" },
      hintUsage: async () => {},
      getConfiguration: async () => ({
        indexerUri: "https://indexer.preprod.midnight.network/api/v3/graphql",
        indexerWsUri: "wss://indexer.preprod.midnight.network/api/v3/graphql/ws",
        substrateNodeUri: "https://rpc.preprod.midnight.network",
        networkId: "preprod",
      }),
      getShieldedAddresses: async () => ({
        shieldedAddress: "private_test_wallet_address",
        shieldedCoinPublicKey: "mn_shield-pub_preprod1privatecoin",
        shieldedEncryptionPublicKey: "mn_shield-epk_preprod1privateencryption",
      }),
      getProvingProvider: async () => {
        runtime.__laceProofAttempts += 1;
        if (rejectFirstProofProvider && runtime.__laceProofAttempts === 1) {
          throw new Error("private proving service detail");
        }
        return {
          check: async () => [],
          prove: async () => new Uint8Array([1]),
        };
      },
      balanceUnsealedTransaction: async () => ({ tx: "00" }),
      submitTransaction: async () => {},
    };

    runtime.midnight = {
      mnLace: {
        rdns: "io.midnight.lace",
        name: "Lace Test Wallet",
        icon: "data:image/svg+xml,ignored",
        apiVersion: "4.0.1",
        connect: async () => {
          runtime.__laceConnectAttempts += 1;
          if (rejectFirstConnection && runtime.__laceConnectAttempts === 1) {
            throw Object.assign(new Error("private rejection detail"), {
              type: "DAppConnectorAPIError",
              code: "PermissionRejected",
              reason: "private wallet reason",
            });
          }
          runtime.__laceConnected = true;
          return connectedApi;
        },
      },
    };
  }, options);
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
  await expect(page.getByText("Local preview", { exact: true })).toBeVisible();
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

test("wallet unavailable is accurate and recoverable", async ({ page }) => {
  await openInteractiveApp(page);
  await page.getByRole("button", { name: "Connect Lace" }).click();

  const walletSetup = page.getByLabel("Lace wallet and proving setup");
  await expect(walletSetup.getByRole("alert")).toContainText("Lace was not found");
  await expect(walletSetup).not.toContainText("private");
  await expect(walletSetup.getByRole("button", { name: "Retry Lace connection" })).toBeEnabled();
});

test("wallet authorization rejection can be retried successfully", async ({ page }) => {
  await installMockLace(page, { rejectFirstConnection: true });
  await openInteractiveApp(page);
  const walletSetup = page.getByLabel("Lace wallet and proving setup");

  await walletSetup.getByRole("button", { name: "Connect Lace" }).click();
  await expect(walletSetup.getByRole("alert")).toContainText("authorization was rejected");
  await expect(walletSetup).not.toContainText("private rejection detail");

  await walletSetup.getByRole("button", { name: "Retry Lace connection" }).click();
  await expect(walletSetup.getByRole("status")).toContainText("Lace Test Wallet connected");
  await expect(walletSetup).toContainText("Wallet-delegated proving is configured");
  await expect(walletSetup).toContainText("No proof or transaction has been requested");
  await expect(page).not.toHaveURL(/wallet|address|private/i);
});

test("proof-provider setup failure is private and recoverable", async ({ page }) => {
  await installMockLace(page, { rejectFirstProofProvider: true });
  await openInteractiveApp(page);
  const walletSetup = page.getByLabel("Lace wallet and proving setup");

  await walletSetup.getByRole("button", { name: "Connect Lace" }).click();
  await expect(walletSetup.getByRole("alert")).toContainText("could not configure its proving provider");
  await expect(walletSetup).not.toContainText("private proving service detail");

  await walletSetup.getByRole("button", { name: "Retry Lace connection" }).click();
  await expect(walletSetup.getByRole("status")).toContainText("Lace Test Wallet connected");
});

test("a disconnected Lace session fails closed and reconnects", async ({ page }) => {
  await installMockLace(page);
  await openInteractiveApp(page);
  const walletSetup = page.getByLabel("Lace wallet and proving setup");

  await walletSetup.getByRole("button", { name: "Connect Lace" }).click();
  await expect(walletSetup.getByRole("status")).toContainText("connected");
  await page.evaluate(() => {
    (window as unknown as { __laceConnected: boolean }).__laceConnected = false;
  });
  await walletSetup.getByRole("button", { name: "Check connection" }).click();
  await expect(walletSetup.getByRole("alert")).toContainText("connection was lost");

  await walletSetup.getByRole("button", { name: "Retry Lace connection" }).click();
  await expect(walletSetup.getByRole("status")).toContainText("Lace Test Wallet connected");
});

test("the deployment surface exposes only the fixed public policy and fails safely without Lace", async ({ page }) => {
  const outboundSubmissions: string[] = [];
  page.on("request", (request) => {
    if (!( ["GET", "HEAD"] as string[]).includes(request.method())) {
      outboundSubmissions.push(`${request.method()} ${request.url()}`);
    }
  });

  await openDeploymentPage(page);
  await expect(page.getByLabel("Policy to deploy")).toContainText("20%");
  await expect(page.getByLabel("Policy to deploy")).toContainText("70%");
  await expect(page.getByLabel("Policy to deploy")).toContainText("60%");
  await expect(page.locator("main")).toContainText("No portfolio allocation is used");
  await expect(page.locator("main")).not.toContainText(/cash|bonds|equities|wallet address|signing key/i);

  await attemptDeploymentWithoutLace(page);
  await expect(page.getByRole("alert")).toContainText("Lace was not found", { timeout: 20_000 });
  await expect(page.getByLabel("Public deployment receipt")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry deployment" })).toBeEnabled();
  expect(outboundSubmissions).toEqual([]);
});
