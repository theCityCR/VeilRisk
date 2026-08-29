import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { SucceedEntirely } from "@midnight-ntwrk/midnight-js-types";
import {
  LaceConnectorError,
  MidnightLifecycleError,
  VerificationError,
  createLaceConnector,
  createVeilRiskMidnightBinding,
  runMidnightCallLifecycle,
  verifyPortfolio,
  verifyPortfolioOnMidnight,
} from "../lib/verification.ts";
import { defaultPolicy } from "./fixtures/policy-vectors.mjs";

const validAllocation = { cash: 1_500, bonds: 2_500, equities: 5_000, speculative: 1_000 };

function createPorts(failOnceAt) {
  const calls = [];
  let remainingFailure = failOnceAt;
  const invoke = async (name, result) => {
    calls.push(name);
    if (remainingFailure === name) {
      remainingFailure = undefined;
      throw new Error(`${name} failed`);
    }
    return result;
  };

  return {
    calls,
    ports: {
      wallet: {
        connect: () => invoke("wallet", undefined),
        sign: (proof) => invoke("signature", { opaqueTransaction: `signed:${proof.opaqueProof}` }),
      },
      proofProvider: {
        generate: (input) => invoke("proof", { opaqueProof: `proof:${input.policy.maxGrowth}` }),
      },
      transaction: {
        submit: () => invoke("submission", { transactionId: "tx_real_provider_result" }),
        waitForFinalization: (transactionId) => invoke("finalization", {
          transactionId,
          network: "Preprod",
          contractAddress: "contract_real_provider_result",
        }),
      },
      indexer: {
        getPublicAttestation: (transactionId) => invoke("indexer", {
          transactionId,
          policyName: "Conservative mandate",
          compliant: true,
        }),
      },
    },
  };
}

describe("injectable verification workflow", () => {
  test("invalid input stops before every external dependency", async () => {
    const { calls, ports } = createPorts();
    const states = [];

    const result = await verifyPortfolio(ports, {
      allocation: { ...validAllocation, cash: 1_499 },
      policy: defaultPolicy,
    }, (state) => states.push(state));

    assert.deepEqual(result, { status: "invalid-locally", failureIds: ["total"] });
    assert.deepEqual(states, [{ status: "invalid-locally", failureIds: ["total"] }]);
    assert.deepEqual(calls, []);
  });

  test("a valid input progresses through injected services in order", async () => {
    const { calls, ports } = createPorts();
    const statuses = [];

    const result = await verifyPortfolio(ports, {
      allocation: validAllocation,
      policy: defaultPolicy,
    }, ({ status }) => statuses.push(status));

    assert.equal(result.status, "finalized");
    assert.deepEqual(calls, ["wallet", "proof", "signature", "submission", "finalization", "indexer"]);
    assert.deepEqual(statuses, [
      "wallet-connection-required",
      "generating-proof",
      "awaiting-signature",
      "submitted",
      "finalized",
    ]);
  });

  test("only the proof provider receives the private allocation", async () => {
    const { ports } = createPorts();
    let proofInput;
    let signatureInput;
    let submissionInput;
    let indexerInput;
    ports.proofProvider.generate = async (input) => {
      proofInput = input;
      return { opaqueProof: "opaque-proof" };
    };
    ports.wallet.sign = async (input) => {
      signatureInput = input;
      return { opaqueTransaction: "opaque-transaction" };
    };
    ports.transaction.submit = async (input) => {
      submissionInput = input;
      return { transactionId: "provider-transaction-id" };
    };
    ports.indexer.getPublicAttestation = async (input) => {
      indexerInput = input;
      return { transactionId: input, policyName: "Conservative mandate", compliant: true };
    };

    await verifyPortfolio(ports, { allocation: validAllocation, policy: defaultPolicy });

    assert.deepEqual(proofInput.allocation, validAllocation);
    const publicInputs = JSON.stringify({ signatureInput, submissionInput, indexerInput });
    for (const privateValue of Object.values(validAllocation)) {
      assert.equal(publicInputs.includes(String(privateValue)), false);
    }
  });

  for (const stage of ["wallet", "proof", "signature", "submission", "finalization", "indexer"]) {
    test(`${stage} failure is explicit and a retry can recover`, async () => {
      const { ports } = createPorts(stage);
      const failedStates = [];

      await assert.rejects(
        verifyPortfolio(ports, { allocation: validAllocation, policy: defaultPolicy }, (state) => failedStates.push(state)),
        (error) => error instanceof VerificationError && error.stage === stage,
      );
      assert.deepEqual(failedStates.at(-1), { status: "failed", stage });

      const retry = await verifyPortfolio(ports, { allocation: validAllocation, policy: defaultPolicy });
      assert.equal(retry.status, "finalized");
    });
  }

  test("an indexer transaction mismatch fails closed", async () => {
    const { ports } = createPorts();
    ports.indexer.getPublicAttestation = async () => ({
      transactionId: "different-transaction",
      policyName: "Conservative mandate",
      compliant: true,
    });

    await assert.rejects(
      verifyPortfolio(ports, { allocation: validAllocation, policy: defaultPolicy }),
      (error) => error instanceof VerificationError && error.stage === "indexer",
    );
  });

});

describe("generated Midnight binding adapter", () => {
  function createBinding(overrides = {}) {
    const calls = [];
    const providers = Object.freeze({ kind: "connected-midnight-providers" });
    const binding = createVeilRiskMidnightBinding({
      network: "Preprod",
      contractAddress: "contract_public_address",
      compiledAssetsBaseUrl: "https://veilrisk.example/contract/veilrisk/",
      connect: async () => {
        calls.push({ name: "connect" });
        if (overrides.connectError) throw overrides.connectError;
        return providers;
      },
      submit: async (receivedProviders, options) => {
        calls.push({ name: "submit", receivedProviders, options });
        if (overrides.submitError) throw overrides.submitError;
        return { public: { txId: "midnight_finalized_transaction" } };
      },
    });
    return { binding, calls, providers };
  }

  test("invalid input never connects to a wallet or invokes Midnight", async () => {
    const { binding, calls } = createBinding();
    const states = [];

    const result = await verifyPortfolioOnMidnight(binding, {
      allocation: { ...validAllocation, cash: 1_499 },
      policy: defaultPolicy,
      policyName: "Conservative mandate",
    }, (state) => states.push(state));

    assert.deepEqual(result, { status: "invalid-locally", failureIds: ["total"] });
    assert.deepEqual(states, [{ status: "invalid-locally", failureIds: ["total"] }]);
    assert.deepEqual(calls, []);
  });

  test("the binding submits private circuit arguments through the generated contract", async () => {
    const { binding, calls, providers } = createBinding();
    const states = [];

    const result = await verifyPortfolioOnMidnight(binding, {
      allocation: validAllocation,
      policy: defaultPolicy,
      policyName: "Conservative mandate",
    }, (state) => states.push(state));

    assert.equal(result.status, "finalized");
    assert.deepEqual(states.map(({ status }) => status), [
      "wallet-connection-required",
      "generating-proof",
      "finalized",
    ]);
    assert.deepEqual(calls.map(({ name }) => name), ["connect", "submit"]);

    const submission = calls[1];
    assert.equal(submission.receivedProviders, providers);
    assert.equal(submission.options.compiledContract.tag, "VeilRisk");
    assert.equal(
      CompiledContract.getCompiledAssetsPath(submission.options.compiledContract),
      "https://veilrisk.example/contract/veilrisk",
    );
    assert.equal(submission.options.circuitId, "proveCompliance");
    assert.equal(submission.options.contractAddress, "contract_public_address");
    assert.deepEqual(submission.options.args, [1_500n, 2_500n, 5_000n, 1_000n]);
    assert.equal(JSON.stringify(result).includes("1500"), false);
    assert.equal(JSON.stringify(result).includes("2500"), false);
    assert.deepEqual(result.transaction, {
      transactionId: "midnight_finalized_transaction",
      network: "Preprod",
      contractAddress: "contract_public_address",
    });
  });

  test("the binding itself fails closed before SDK submission for invalid input", async () => {
    const { binding, calls, providers } = createBinding();

    await assert.rejects(
      binding.submitCompliance(providers, {
        allocation: { ...validAllocation, speculative: 2_001, cash: 499 },
        policy: defaultPolicy,
      }),
      /cannot be submitted/,
    );
    assert.deepEqual(calls, []);
  });

  test("wallet and proof-preparation failures are explicit and retryable", async () => {
    for (const [failureKey, expectedStage] of [["connectError", "wallet"], ["submitError", "proof"]]) {
      const failure = new Error(`${expectedStage} unavailable`);
      const first = createBinding({ [failureKey]: failure });

      await assert.rejects(
        verifyPortfolioOnMidnight(first.binding, {
          allocation: validAllocation,
          policy: defaultPolicy,
          policyName: "Conservative mandate",
        }),
        (error) => error instanceof VerificationError && error.stage === expectedStage,
      );

      const retry = createBinding();
      assert.equal((await verifyPortfolioOnMidnight(retry.binding, {
        allocation: validAllocation,
        policy: defaultPolicy,
        policyName: "Conservative mandate",
      })).status, "finalized");
    }
  });

  test("empty public configuration and transaction identifiers fail closed", async () => {
    assert.throws(() => createVeilRiskMidnightBinding({
      network: " ",
      contractAddress: "contract_public_address",
      compiledAssetsBaseUrl: "https://veilrisk.example/contract/veilrisk",
      connect: async () => ({}),
    }), /network must not be empty/i);

    const binding = createVeilRiskMidnightBinding({
      network: "Preprod",
      contractAddress: "contract_public_address",
      compiledAssetsBaseUrl: "https://veilrisk.example/contract/veilrisk",
      connect: async () => ({}),
      submit: async () => ({ public: { txId: "" } }),
    });
    await assert.rejects(
      verifyPortfolioOnMidnight(binding, {
        allocation: validAllocation,
        policy: defaultPolicy,
        policyName: "Conservative mandate",
      }),
      (error) => error instanceof VerificationError && error.stage === "midnight",
    );
  });
});

describe("real Midnight call lifecycle", () => {
  function createLifecycle(failAt) {
    const calls = [];
    const invoke = async (name, result) => {
      calls.push(name);
      if (failAt === name) throw new Error("private lifecycle detail");
      return result;
    };
    const providers = {
      proofProvider: {
        proveTx: (transaction) => invoke("proof", { proven: transaction }),
      },
      walletProvider: {
        balanceTx: (transaction) => invoke("signature", { balanced: transaction }),
      },
      midnightProvider: {
        submitTx: () => invoke("submission", "public_transaction_id"),
      },
      publicDataProvider: {
        watchForTxData: () => invoke("finalization", {
          status: SucceedEntirely,
          identifiers: ["canonical_transaction_id", "public_transaction_id"],
        }),
      },
    };
    const prepare = () => invoke("prepare", {
      private: { unprovenTx: { forbiddenAllocation: validAllocation } },
    });
    return { calls, prepare, providers };
  }

  test("proof, Lace approval, submission, and finalization progress in order", async () => {
    const { calls, prepare, providers } = createLifecycle();
    const states = [];

    const result = await runMidnightCallLifecycle(
      providers,
      prepare,
      (state) => states.push(state),
    );

    assert.deepEqual(calls, ["prepare", "proof", "signature", "submission", "finalization"]);
    assert.deepEqual(states, [
      { status: "awaiting-signature" },
      { status: "submitting" },
      { status: "submitted", transactionId: "public_transaction_id" },
    ]);
    assert.deepEqual(result, { public: { txId: "public_transaction_id" } });
    assert.doesNotMatch(JSON.stringify({ states, result }), /1500|2500|5000|1000/);
  });

  for (const [failure, stage] of [
    ["prepare", "proof"],
    ["proof", "proof"],
    ["signature", "signature"],
    ["submission", "submission"],
    ["finalization", "finalization"],
  ]) {
    test(`${failure} failure is classified as ${stage} without exposing its cause`, async () => {
      const { prepare, providers } = createLifecycle(failure);
      await assert.rejects(
        runMidnightCallLifecycle(providers, prepare),
        (error) => error instanceof MidnightLifecycleError
          && error.stage === stage
          && !error.message.includes("private lifecycle detail"),
      );
    });
  }

  test("a mismatched or failed finalized transaction fails closed", async () => {
    for (const finalized of [
      { status: "FailEntirely", identifiers: ["public_transaction_id"] },
      { status: SucceedEntirely, identifiers: ["different_transaction_id"] },
    ]) {
      const { prepare, providers } = createLifecycle();
      providers.publicDataProvider.watchForTxData = async () => finalized;
      await assert.rejects(
        runMidnightCallLifecycle(providers, prepare),
        (error) => error instanceof MidnightLifecycleError
          && error.stage === "finalization",
      );
    }
  });
});

describe("Lace connector and provider configuration", () => {
  const apiError = (code) => Object.assign(new Error("wallet detail must stay private"), {
    type: "DAppConnectorAPIError",
    code,
    reason: "private connector reason",
  });

  function createLaceHarness(overrides = {}) {
    const calls = [];
    let connected = true;
    let connectAttempts = 0;
    let proofAttempts = 0;
    const connectedApi = {
      async getConnectionStatus() {
        calls.push("status");
        return connected
          ? { status: "connected", networkId: "preprod" }
          : { status: "disconnected" };
      },
      async hintUsage(methods) {
        calls.push(["hint", ...methods]);
        if (overrides.hintError) throw overrides.hintError;
      },
      async getConfiguration() {
        calls.push("configuration");
        return {
          indexerUri: "https://indexer.preprod.midnight.network/api/v3/graphql",
          indexerWsUri: "wss://indexer.preprod.midnight.network/api/v3/graphql/ws",
          substrateNodeUri: "https://rpc.preprod.midnight.network",
          networkId: overrides.configNetwork ?? "preprod",
        };
      },
      async getShieldedAddresses() {
        calls.push("addresses");
        return {
          shieldedAddress: "private_wallet_address",
          shieldedCoinPublicKey: "mn_shield-pub_preprod1privatecoin",
          shieldedEncryptionPublicKey: "mn_shield-epk_preprod1privateencryption",
        };
      },
      async getProvingProvider() {
        calls.push("proving-provider");
        proofAttempts += 1;
        if (overrides.proofErrorOnce && proofAttempts === 1) throw overrides.proofErrorOnce;
        return {
          check: async () => [],
          prove: async () => new Uint8Array([1]),
        };
      },
      async balanceUnsealedTransaction() {
        calls.push("balance");
        if (overrides.balanceError) throw overrides.balanceError;
        return { tx: "00" };
      },
      async submitTransaction() {
        calls.push("submit-transaction");
        if (overrides.submitError) throw overrides.submitError;
      },
    };
    const initialApi = {
      rdns: "io.midnight.lace",
      name: "  Lace <wallet>  ",
      icon: "data:image/svg+xml,ignored",
      apiVersion: overrides.apiVersion ?? "4.0.1",
      async connect(network) {
        calls.push(["connect", network]);
        connectAttempts += 1;
        if (overrides.connectErrorOnce && connectAttempts === 1) throw overrides.connectErrorOnce;
        connected = true;
        return connectedApi;
      },
    };
    const connector = createLaceConnector({
      network: "preprod",
      compiledAssetsBaseUrl: "https://veilrisk.example/contract/veilrisk",
      getWalletRegistry: () => overrides.noWallet
        ? undefined
        : overrides.unrelatedWallet
          ? { anotherWallet: { ...initialApi, rdns: "example.wallet", name: "Another wallet" } }
          : { mnLace: initialApi },
      fetch: async () => { throw new Error("No asset fetch is expected during setup."); },
    });
    return {
      calls,
      connector,
      connectedApi,
      disconnect: () => { connected = false; },
    };
  }

  test("missing and incompatible wallets fail without external requests", async () => {
    for (const [overrides, reason] of [
      [{ noWallet: true }, "unavailable"],
      [{ unrelatedWallet: true }, "unavailable"],
      [{ apiVersion: "3.0.0" }, "incompatible"],
    ]) {
      const { connector, calls } = createLaceHarness(overrides);
      await assert.rejects(
        connector.connect(),
        (error) => error instanceof LaceConnectorError && error.reason === reason,
      );
      assert.deepEqual(calls, []);
    }
  });

  test("connects on Preprod and configures wallet-delegated proving without exposing wallet data", async () => {
    const { connector, calls } = createLaceHarness();
    const summary = await connector.connect();
    const providers = await connector.getProviders();

    assert.deepEqual(summary, {
      walletName: "Lace <wallet>",
      apiVersion: "4.0.1",
      network: "preprod",
      proofMode: "wallet-delegated",
    });
    assert.ok(providers.zkConfigProvider);
    assert.ok(providers.proofProvider);
    assert.ok(providers.publicDataProvider);
    assert.ok(providers.walletProvider);
    assert.ok(providers.midnightProvider);
    assert.equal(JSON.stringify(summary).includes("private_wallet_address"), false);
    assert.equal(JSON.stringify(summary).includes("privatecoin"), false);
    assert.deepEqual(calls[0], ["connect", "preprod"]);
    assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "hint"), false);
  });

  test("setup does not make an eager permission-hint request", async () => {
    const { connector, calls } = createLaceHarness({
      hintError: apiError("InternalError"),
    });

    assert.equal((await connector.connect()).network, "preprod");
    assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "hint"), false);
  });

  test("permission and proof-provider failures can be retried", async () => {
    for (const [overrides, reason] of [
      [{ connectErrorOnce: apiError("PermissionRejected") }, "permission-rejected"],
      [{ proofErrorOnce: new Error("proof setup unavailable") }, "proof-provider-unavailable"],
    ]) {
      const { connector } = createLaceHarness(overrides);
      await assert.rejects(
        connector.connect(),
        (error) => error instanceof LaceConnectorError && error.reason === reason,
      );
      assert.equal((await connector.connect()).proofMode, "wallet-delegated");
    }
  });

  test("nested and internal connection errors produce actionable private-safe reasons", async () => {
    for (const [error, reason] of [
      [new Error("wrapper", { cause: apiError("PermissionRejected") }), "permission-rejected"],
      [apiError("InternalError"), "wallet-unresponsive"],
      [apiError("InvalidRequest"), "wallet-unresponsive"],
    ]) {
      const { connector } = createLaceHarness({ connectErrorOnce: error });
      await assert.rejects(
        connector.connect(),
        (cause) => cause instanceof LaceConnectorError
          && cause.reason === reason
          && !cause.message.includes("wallet detail"),
      );
    }
  });

  test("a disconnected session fails closed and reconnects cleanly", async () => {
    const { connector, disconnect } = createLaceHarness();
    await connector.connect();
    disconnect();

    await assert.rejects(
      connector.checkConnection(),
      (error) => error instanceof LaceConnectorError && error.reason === "disconnected",
    );
    assert.equal((await connector.connect()).network, "preprod");
  });

  test("signature and submission rejections are classified without leaking connector details", async () => {
    const signatureHarness = createLaceHarness({ balanceError: apiError("Rejected") });
    await signatureHarness.connector.connect();
    const signatureProviders = await signatureHarness.connector.getProviders();
    await assert.rejects(
      signatureProviders.walletProvider.balanceTx({ serialize: () => new Uint8Array([1]) }),
      (error) => error instanceof LaceConnectorError
        && error.reason === "signature-rejected"
        && !error.message.includes("wallet detail"),
    );

    const submissionHarness = createLaceHarness({ submitError: apiError("Rejected") });
    await submissionHarness.connector.connect();
    const submissionProviders = await submissionHarness.connector.getProviders();
    await assert.rejects(
      submissionProviders.midnightProvider.submitTx({
        serialize: () => new Uint8Array([1]),
        identifiers: () => ["public_transaction_id"],
      }),
      (error) => error instanceof LaceConnectorError
        && error.reason === "submission-rejected"
        && !error.message.includes("wallet detail"),
    );
  });

  test("signature rejection maps to the signature stage and a retry can recover", async () => {
    let reject = true;
    const states = [];
    const midnight = {
      connect: async () => ({}),
      submitCompliance: async () => {
        if (reject) throw new LaceConnectorError("signature-rejected");
        return {
          transactionId: "public_transaction_id",
          network: "preprod",
          contractAddress: "public_contract_address",
        };
      },
    };
    const input = {
      allocation: validAllocation,
      policy: defaultPolicy,
      policyName: "Conservative mandate",
    };

    await assert.rejects(
      verifyPortfolioOnMidnight(midnight, input, (state) => states.push(state)),
      (error) => error instanceof VerificationError && error.stage === "signature",
    );
    assert.deepEqual(states.at(-1), { status: "failed", stage: "signature" });

    reject = false;
    assert.equal((await verifyPortfolioOnMidnight(midnight, input)).status, "finalized");
  });
});
