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
      hintUsage: async () => {
        throw new Error("private eager permission hint failure");
      },
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

type MockMidnightStage = "wallet" | "proof" | "signature" | "submission" | "finalization";

async function installMockMidnight(
  page: import("@playwright/test").Page,
  options: { failOnceAt?: MockMidnightStage; pauseAt?: Exclude<MockMidnightStage, "wallet"> } = {},
) {
  await page.addInitScript(({ failOnceAt, pauseAt }) => {
    (window as unknown as {
      __veilriskE2EMidnightController: {
        calls: string[];
        failOnceAt?: MockMidnightStage;
        pauseAt?: Exclude<MockMidnightStage, "wallet">;
      };
    }).__veilriskE2EMidnightController = {
      calls: [],
      failOnceAt,
      pauseAt,
    };
  }, options);
}

async function continueMockMidnight(
  page: import("@playwright/test").Page,
  currentStage: Exclude<MockMidnightStage, "wallet">,
  nextStage?: Exclude<MockMidnightStage, "wallet">,
) {
  await page.evaluate(({ currentStage, nextStage }) => {
    const runtime = window as unknown as {
      __veilriskE2EMidnightController: { pauseAt?: string };
    };
    runtime.__veilriskE2EMidnightController.pauseAt = nextStage;
    window.dispatchEvent(new Event(`veilrisk:e2e:continue:${currentStage}`));
  }, { currentStage, nextStage });
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
  await page.getByRole("button", { name: "Create private local preview" }).click();

  await expect(page.getByRole("alert")).toContainText("failed locally");
  await expect(publicPanel).toContainText("No attestation");
  await expect(publicPanel).not.toContainText("Speculative exposure");
  await expect(publicPanel).not.toContainText("Policy not satisfied");
  await expect(page).not.toHaveURL(/vr_|allocation|portfolio/i);
  expect(outboundSubmissions).toEqual([]);
});

test("a compliant portfolio creates only an explicitly local preview", async ({ page }) => {
  await openInteractiveApp(page);
  await page.getByRole("button", { name: "Create private local preview" }).click();

  const publicPanel = page.locator(".public-panel");
  await expect(publicPanel).toContainText("Private local preview · not on-chain");
  await expect(publicPanel).toContainText("Compliant locally");
  await expect(publicPanel).toContainText("Not submitted");
  await expect(publicPanel).not.toContainText("Midnight Preprod");
  await expect(publicPanel).not.toContainText(/vr_[a-z0-9]+/i);
  await expect(page.getByText("Private preview · not public", { exact: true })).toBeVisible();
});

test("editing private input clears a stale local preview", async ({ page }) => {
  await openInteractiveApp(page);
  await page.getByRole("button", { name: "Create private local preview" }).click();
  await expect(page.locator(".public-panel")).toContainText("Compliant locally");

  await page.getByRole("slider", { name: "Cash" }).fill("1600");

  await expect(page.locator(".public-panel")).toContainText("No attestation");
  await expect(page.locator(".private-panel")).toContainText("Needs changes");
});

test("changing the public policy clears a stale local preview", async ({ page }) => {
  await openInteractiveApp(page);
  await page.getByRole("button", { name: "Create private local preview" }).click();
  await expect(page.locator(".public-panel")).toContainText("Compliant locally");

  await page.getByLabel("Speculative cap").selectOption("1000");

  await expect(page.locator(".public-panel")).toContainText("No attestation");
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
    await page.getByRole("button", { name: "Create private local preview" }).click();

    if (vector.passed) {
      await expect(page.locator(".public-panel")).toContainText("Compliant locally");
    } else {
      await expect(page.getByRole("alert")).toContainText("failed locally");
      await expect(page.locator(".public-panel")).toContainText("No attestation");
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

  const previewButton = page.getByRole("button", { name: "Create private local preview" });
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
  await page.getByRole("button", { name: "Create private local preview" }).click();
  await expect(page.locator(".public-panel")).toContainText("Compliant locally");

  await page.reload();
  await page.waitForFunction(() => typeof document.querySelector<HTMLButtonElement>(".prove-button")?.onclick === "function");
  await expect(page.getByRole("slider", { name: "Cash" })).toHaveValue("1500");
  await expect(page.locator(".public-panel")).toContainText("No attestation");

  const stored = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(stored).toEqual({ local: {}, session: {} });

  const freshPage = await context.newPage();
  await openInteractiveApp(freshPage);
  await expect(freshPage.getByRole("slider", { name: "Cash" })).toHaveValue("1500");
  await expect(freshPage.locator(".public-panel")).toContainText("No attestation");
  await freshPage.close();
});

test("private allocations stay out of URLs, storage, and the shareable panel", async ({ page }) => {
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  await openInteractiveApp(page);

  await page.getByRole("slider", { name: "Cash" }).fill("1501");
  await page.getByRole("slider", { name: "Bonds" }).fill("2499");
  await page.getByRole("button", { name: "Create private local preview" }).click();

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
  await expect(walletSetup).toContainText("Wallet-delegated proving is ready");
  await expect(walletSetup).toContainText("signature is requested only after a valid proof");
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

test("invalid input and an undeployed policy never reach the Midnight verification adapter", async ({ page }) => {
  await installMockMidnight(page);
  await openInteractiveApp(page);

  await page.getByRole("button", { name: "Risky demo" }).click();
  await page.getByRole("button", { name: "Verify privately on Preprod" }).click();
  await expect(page.getByRole("alert")).toContainText("failed locally");

  let calls = await page.evaluate(() => (
    window as unknown as { __veilriskE2EMidnightController: { calls: string[] } }
  ).__veilriskE2EMidnightController.calls);
  expect(calls).toEqual([]);

  await page.getByRole("button", { name: "Balanced demo" }).click();
  await page.getByLabel("Speculative cap").selectOption("3000");
  await page.getByRole("button", { name: "Verify privately on Preprod" }).click();
  await expect(page.getByRole("alert")).toContainText("uses the deployed 20% policy");
  calls = await page.evaluate(() => (
    window as unknown as { __veilriskE2EMidnightController: { calls: string[] } }
  ).__veilriskE2EMidnightController.calls);
  expect(calls).toEqual([]);
  await expect(page.locator(".public-panel")).not.toContainText("Compliant on-chain");
});

test("a real verification progresses through proof, Lace approval, submission, and finalization", async ({ page }) => {
  const outboundSubmissions: string[] = [];
  page.on("request", (request) => {
    if (!( ["GET", "HEAD"] as string[]).includes(request.method())) {
      outboundSubmissions.push(`${request.method()} ${request.url()}`);
    }
  });
  await installMockMidnight(page, { pauseAt: "proof" });
  await openInteractiveApp(page);

  await page.getByRole("button", { name: "Verify privately on Preprod" }).click();
  await expect(page.locator(".public-panel")).toContainText("Generating zero-knowledge proof");
  await expect(page.getByRole("slider", { name: "Cash" })).toBeDisabled();

  await continueMockMidnight(page, "proof", "signature");
  await expect(page.locator(".public-panel")).toContainText("Approve the transaction in Lace");

  await continueMockMidnight(page, "signature", "submission");
  await expect(page.locator(".public-panel")).toContainText("Submitting to Midnight Preprod");

  await continueMockMidnight(page, "submission", "finalization");
  await expect(page.locator(".public-panel")).toContainText("awaiting Preprod finalization");
  await expect(page.locator(".public-panel")).toContainText("public_compliance_transaction_id");

  await continueMockMidnight(page, "finalization");
  const publicPanel = page.locator(".public-panel");
  await expect(publicPanel).toContainText("Verified on Midnight Preprod");
  await expect(publicPanel).toContainText("Compliant on-chain");
  await expect(publicPanel).toContainText("3e3ab54fd9383a11b457cc48b73e084db0aaf63ad3499c149cc1b43e1cf4e4f6");
  await expect(publicPanel).toContainText("public_compliance_transaction_id");
  await expect(publicPanel).toContainText("Holdings disclosed");
  await expect(publicPanel).toContainText("None");

  const publicText = await publicPanel.innerText();
  for (const prohibitedValue of ["1500", "2500", "5000", "1000", "15%", "25%", "50%", "10%"] ) {
    expect(publicText).not.toContain(prohibitedValue);
    expect(page.url()).not.toContain(prohibitedValue);
  }
  const browserState = await page.evaluate(() => {
    const controller = (
      window as unknown as {
        __veilriskE2EMidnightController: {
          calls: string[];
          privateInput: { allocation: Record<string, number> };
        };
      }
    ).__veilriskE2EMidnightController;
    return {
      calls: controller.calls,
      privateInput: controller.privateInput,
      storage: JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    };
  });
  expect(browserState.calls).toEqual(["wallet", "proof", "signature", "submission", "finalization"]);
  expect(browserState.privateInput.allocation).toEqual({
    cash: 1500,
    bonds: 2500,
    equities: 5000,
    speculative: 1000,
  });
  expect(browserState.storage).not.toMatch(/1500|2500|5000|1000/);
  expect(outboundSubmissions).toEqual([]);

  await page.getByRole("slider", { name: "Cash" }).fill("1501");
  await expect(publicPanel).toContainText("No attestation");
  await expect(publicPanel).not.toContainText("public_compliance_transaction_id");
});

for (const [stage, message] of [
  ["proof", "Proof generation failed"],
  ["signature", "did not approve the transaction"],
  ["submission", "could not be submitted"],
  ["finalization", "could not be confirmed by the Preprod indexer"],
] as const) {
  test(`${stage} failure is public-safe and a retry can finalize`, async ({ page }) => {
    await installMockMidnight(page, { failOnceAt: stage });
    await openInteractiveApp(page);

    await page.getByRole("button", { name: "Verify privately on Preprod" }).click();
    const publicPanel = page.locator(".public-panel");
    await expect(publicPanel.getByRole("alert")).toContainText(message);
    await expect(publicPanel).not.toContainText("Private deterministic E2E failure detail");
    if (stage === "finalization") {
      await expect(publicPanel).toContainText("public_compliance_transaction_id");
    }

    await page.getByRole("button", { name: "Retry on-chain verification" }).click();
    await expect(publicPanel).toContainText("Compliant on-chain");
  });
}

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
