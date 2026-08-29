import assert from "node:assert/strict";
import test from "node:test";
import { createConstructorContext } from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger } from "../contract/src/managed/veilrisk/contract/index.js";
import {
  createVeilRiskDeployment,
  DeploymentError,
} from "../lib/deployment.ts";
import { DEFAULT_POLICY } from "../lib/risk.ts";
import deploymentRecord from "../config/preprod-deployment.json" with { type: "json" };

function publicStateFor(policy = DEFAULT_POLICY, successfulProofs = 0n) {
  const contract = new Contract({});
  const initial = contract.initialState(
    createConstructorContext({}, "0".repeat(64)),
    BigInt(policy.maxSpeculative),
    BigInt(policy.maxGrowth),
    BigInt(policy.maxSingleBucket),
  );
  if (successfulProofs === 0n) return initial.currentContractState.data;

  throw new Error("This fixture only supports an undeclared proof counter.");
}

function harness(options = {}) {
  const calls = [];
  const state = options.state ?? publicStateFor();
  const deploy = createVeilRiskDeployment({
    network: "preprod",
    compiledAssetsBaseUrl: "https://app.example/contract/veilrisk",
    connect: async () => {
      calls.push({ name: "connect" });
      if (options.connectError) throw options.connectError;
      return { publicDataProvider: {} };
    },
    deploy: async (_providers, deploymentOptions) => {
      calls.push({ name: "deploy", options: deploymentOptions });
      if (options.deployError) throw options.deployError;
      return {
        deployTxData: {
          public: {
            contractAddress: "a".repeat(64),
            txId: "public_deployment_tx",
          },
          private: { forbidden: "wallet signing key" },
        },
      };
    },
    readPublicContractState: async (_providers, contractAddress) => {
      calls.push({ name: "read-public-state", contractAddress });
      if (options.stateError) throw options.stateError;
      return state;
    },
  });
  return { calls, deploy };
}

test("deploys the fixed policy and returns only verified public identifiers", async () => {
  const { calls, deploy } = harness();
  const states = [];

  const result = await deploy(DEFAULT_POLICY, (state) => states.push(state));

  assert.deepEqual(result, {
    network: "preprod",
    contractAddress: "a".repeat(64),
    transactionId: "public_deployment_tx",
    policy: DEFAULT_POLICY,
    publicStateVerified: true,
  });
  assert.deepEqual(calls.map(({ name }) => name), ["connect", "deploy", "read-public-state"]);
  assert.deepEqual(calls[1].options.args, [2000n, 7000n, 6000n]);
  assert.deepEqual(states.map(({ status }) => status), [
    "connecting-wallet",
    "awaiting-deployment",
    "verifying-public-state",
    "finalized",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /wallet signing key|forbidden/i);
  assert.deepEqual(ledger(publicStateFor()), {
    maxSpeculativeBps: 2000n,
    maxGrowthBps: 7000n,
    maxSingleBucketBps: 6000n,
    successfulProofs: 0n,
  });
});

test("invalid policy limits fail before wallet connection or deployment", async () => {
  const { calls, deploy } = harness();

  await assert.rejects(
    deploy({ ...DEFAULT_POLICY, maxSpeculative: 10_001 }),
    /integer basis points between 0 and 10,000/,
  );
  assert.deepEqual(calls, []);
});

test("wallet and deployment rejection are recoverable and do not expose private causes", async () => {
  for (const [stage, option] of [
    ["wallet", { connectError: new Error("private wallet detail") }],
    ["deployment", { deployError: new Error("private transaction detail") }],
  ]) {
    const first = harness(option);
    await assert.rejects(first.deploy(DEFAULT_POLICY), (error) => {
      assert.ok(error instanceof DeploymentError);
      assert.equal(error.stage, stage);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });

    const retry = harness();
    assert.equal((await retry.deploy(DEFAULT_POLICY)).publicStateVerified, true);
  }
});

test("a public-state mismatch preserves the public receipt for safe recovery", async () => {
  const mismatchedPolicy = { ...DEFAULT_POLICY, maxSpeculative: 1000 };
  const { deploy } = harness({ state: publicStateFor(mismatchedPolicy) });

  await assert.rejects(deploy(DEFAULT_POLICY), (error) => {
    assert.ok(error instanceof DeploymentError);
    assert.equal(error.stage, "public-state");
    assert.deepEqual(error.receipt, {
      network: "preprod",
      contractAddress: "a".repeat(64),
      transactionId: "public_deployment_tx",
      policy: DEFAULT_POLICY,
    });
    assert.doesNotMatch(JSON.stringify(error.receipt), /wallet|private|allocation/i);
    return true;
  });
});

test("the tracked Preprod deployment record is public-only and matches the app policy", () => {
  assert.deepEqual(deploymentRecord, {
    network: "preprod",
    policyName: "Conservative mandate",
    policy: DEFAULT_POLICY,
    contractAddress: null,
    deploymentTransactionId: null,
    publicStateVerified: false,
  });
  assert.doesNotMatch(
    JSON.stringify(deploymentRecord),
    /allocation|witness|signing.?key|wallet.?address|private.?state/i,
  );
});
