import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Subject } from "rxjs";
import {
  createPublicDeploymentRecord,
  LocalDeploymentCommandError,
  readHiddenRecoveryPhrase,
  runLocalPreprodDeployment,
  writePublicDeploymentRecord,
} from "../lib/local-preprod-deployment.ts";
import { DEFAULT_POLICY } from "../lib/risk.ts";
import {
  HeadlessWalletError,
  openHeadlessPreprodWallet,
  requireDustBalance,
  retryWalletSynchronization,
  waitForWalletSynchronization,
} from "../lib/headless-midnight-wallet.ts";

const PRIVATE_SENTINEL = "private recovery phrase sentinel";
const VERIFIED_DEPLOYMENT = {
  network: "preprod",
  contractAddress: "a".repeat(64),
  transactionId: "public_deployment_tx",
  policy: DEFAULT_POLICY,
  publicStateVerified: true,
};

function commandHarness(overrides = {}) {
  const events = [];
  const session = {
    providers: { publicDataProvider: {} },
    close: async () => events.push("close"),
  };
  const dependencies = {
    preflight: async () => events.push("preflight"),
    readRecoveryPhrase: async () => {
      events.push("read-secret");
      return PRIVATE_SENTINEL;
    },
    openWallet: async (phrase) => {
      events.push(["open-wallet", phrase]);
      return session;
    },
    deployPolicy: async (receivedSession, report) => {
      assert.equal(receivedSession, session);
      events.push("deploy");
      report("public deployment status");
      return VERIFIED_DEPLOYMENT;
    },
    persistReceipt: async (deployment) => events.push(["persist", deployment]),
    report: (message) => events.push(["report", message]),
    ...overrides,
  };
  return { dependencies, events, session };
}

test("the local command deploys, persists only after verification, and closes the wallet", async () => {
  const { dependencies, events } = commandHarness();

  assert.deepEqual(await runLocalPreprodDeployment(dependencies), VERIFIED_DEPLOYMENT);
  assert.deepEqual(
    events.filter((event) => typeof event === "string"),
    ["preflight", "read-secret", "deploy", "close"],
  );
  assert.equal(events.findIndex((event) => Array.isArray(event) && event[0] === "persist")
    < events.indexOf("close"), true);

  const publicArtifacts = JSON.stringify(
    events.filter((event) => Array.isArray(event) && event[0] !== "open-wallet"),
  );
  assert.doesNotMatch(publicArtifacts, new RegExp(PRIVATE_SENTINEL));
  assert.doesNotMatch(publicArtifacts, /allocation|witness|wallet.?address/i);
});

test("preflight failure happens before requesting the recovery phrase", async () => {
  const { dependencies, events } = commandHarness({
    preflight: async () => {
      events.push("preflight");
      throw new LocalDeploymentCommandError("Proof server unavailable.");
    },
  });

  await assert.rejects(runLocalPreprodDeployment(dependencies), /Proof server unavailable/);
  assert.deepEqual(events, [
    ["report", "Checking the local proof server and compiled contract assets..."],
    "preflight",
  ]);
});

test("wallet and deployment failures never save a receipt and always close an opened wallet", async () => {
  const walletFailure = commandHarness({
    openWallet: async () => {
      throw new LocalDeploymentCommandError("Wallet could not synchronize.");
    },
  });
  await assert.rejects(
    runLocalPreprodDeployment(walletFailure.dependencies),
    /Wallet could not synchronize/,
  );
  assert.equal(walletFailure.events.some((event) => Array.isArray(event) && event[0] === "persist"), false);
  assert.equal(walletFailure.events.includes("close"), false);

  const deploymentFailure = commandHarness({
    deployPolicy: async () => {
      throw new LocalDeploymentCommandError("Deployment failed safely.");
    },
  });
  await assert.rejects(
    runLocalPreprodDeployment(deploymentFailure.dependencies),
    /Deployment failed safely/,
  );
  assert.equal(deploymentFailure.events.some((event) => Array.isArray(event) && event[0] === "persist"), false);
  assert.equal(deploymentFailure.events.includes("close"), true);
});

test("the public record contains only the fixed policy and verified public identifiers", async () => {
  assert.deepEqual(createPublicDeploymentRecord(VERIFIED_DEPLOYMENT), {
    network: "preprod",
    policyName: "Conservative mandate",
    policy: DEFAULT_POLICY,
    contractAddress: "a".repeat(64),
    deploymentTransactionId: "public_deployment_tx",
    publicStateVerified: true,
  });

  const directory = await mkdtemp(path.join(os.tmpdir(), "veilrisk-public-record-"));
  const recordPath = path.join(directory, "preprod-deployment.json");
  await writePublicDeploymentRecord(recordPath, VERIFIED_DEPLOYMENT);
  const written = await readFile(recordPath, "utf8");
  assert.deepEqual(JSON.parse(written), createPublicDeploymentRecord(VERIFIED_DEPLOYMENT));
  assert.doesNotMatch(written, /allocation|witness|recovery|wallet|private/i);

  assert.throws(
    () => createPublicDeploymentRecord({
      ...VERIFIED_DEPLOYMENT,
      policy: { ...DEFAULT_POLICY, maxGrowth: DEFAULT_POLICY.maxGrowth - 1 },
    }),
    /not verified for the fixed Preprod policy/,
  );
});

test("tDUST readiness accepts the first positive unit and rejects an empty tank", () => {
  assert.equal(requireDustBalance(1n), 1n);
  assert.throws(() => requireDustBalance(0n), /tDUST tank is empty/);
});

test("interrupted Preprod synchronization retries locally and can recover", async () => {
  let attempts = 0;
  const reports = [];
  const result = await retryWalletSynchronization(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error(PRIVATE_SENTINEL);
    return "synchronized";
  }, (message) => reports.push(message));

  assert.equal(result, "synchronized");
  assert.equal(attempts, 3);
  assert.deepEqual(reports, [
    "Preprod wallet synchronization was interrupted; retrying locally (2/3)...",
    "Preprod wallet synchronization was interrupted; retrying locally (3/3)...",
  ]);
  assert.doesNotMatch(JSON.stringify(reports), new RegExp(PRIVATE_SENTINEL));
});

test("a known tDUST sync failure receives safe specific guidance", async () => {
  let dustAttempts = 0;
  await assert.rejects(
    retryWalletSynchronization(async () => {
      dustAttempts += 1;
      throw new Error(
        "wallet wrapper",
        { cause: new Error("values inserted non-linearly into dust commitment tree") },
      );
    }),
    (error) => {
      assert.ok(error instanceof HeadlessWalletError);
      assert.match(error.message, /known intermittent tDUST synchronization fault/);
      assert.doesNotMatch(error.message, /commitment tree/i);
      return true;
    },
  );
  assert.equal(dustAttempts, 3);
});

test("cold wallet synchronization waits for completion and reports public-safe progress", async () => {
  const states = new Subject();
  const reports = [];
  let currentTime = 0;
  let settled = false;
  const synchronized = waitForWalletSynchronization(
    { state: () => states },
    (message) => reports.push(message),
    () => currentTime,
  ).then((state) => {
    settled = true;
    return state;
  });

  states.next({ isSynced: false });
  currentTime = 300_001;
  states.next({ isSynced: false });
  await Promise.resolve();
  assert.equal(settled, false);

  states.next({ isSynced: true });
  assert.deepEqual(await synchronized, { isSynced: true });
  assert.deepEqual(reports, [
    "Wallet synchronization is still running; first-time sync may take several minutes...",
    "Wallet synchronization is still running; first-time sync may take several minutes...",
  ]);
  assert.doesNotMatch(JSON.stringify(reports), /balance|address|allocation|private/i);
});

test("local validation failures do not retry wallet synchronization", async () => {
  let attempts = 0;
  await assert.rejects(
    retryWalletSynchronization(async () => {
      attempts += 1;
      throw new HeadlessWalletError("The tDUST tank is empty.");
    }),
    /tDUST tank is empty/,
  );
  assert.equal(attempts, 1);
});

test("an invalid recovery phrase fails locally without disclosing its contents", async () => {
  await assert.rejects(
    openHeadlessPreprodWallet(PRIVATE_SENTINEL, "/unused/compiled/assets"),
    (error) => {
      assert.ok(error instanceof HeadlessWalletError);
      assert.match(error.message, /not a valid BIP-39 phrase/);
      assert.doesNotMatch(error.message, new RegExp(PRIVATE_SENTINEL));
      return true;
    },
  );
});

test("a redirected recovery phrase is refused without reading it", async () => {
  const input = new Readable({
    read() {
      this.push(PRIVATE_SENTINEL);
      this.push(null);
    },
  });
  input.isTTY = false;
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  output.isTTY = true;

  await assert.rejects(
    readHiddenRecoveryPhrase(input, output),
    /interactive terminal; redirected recovery phrases are refused/,
  );
});

test("the interactive prompt returns input without echoing it", async () => {
  const rawModeChanges = [];
  let visibleOutput = "";
  const input = new Readable({
    read() {
      this.push(`${PRIVATE_SENTINEL}\n`);
      this.push(null);
    },
  });
  input.isTTY = true;
  input.setRawMode = (enabled) => rawModeChanges.push(enabled);
  const output = new Writable({
    write(chunk, _encoding, callback) {
      visibleOutput += chunk.toString();
      callback();
    },
  });
  output.isTTY = true;

  assert.equal(await readHiddenRecoveryPhrase(input, output), PRIVATE_SENTINEL);
  assert.deepEqual(rawModeChanges, [true, false]);
  assert.equal(visibleOutput, "Lace recovery phrase (hidden): \n");
  assert.doesNotMatch(visibleOutput, new RegExp(PRIVATE_SENTINEL));
});

test("the executable refuses command-line secrets before wallet access", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/deploy-preprod.ts", PRIVATE_SENTINEL],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /accepts no arguments/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(PRIVATE_SENTINEL));
});
