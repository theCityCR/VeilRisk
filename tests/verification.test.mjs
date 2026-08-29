import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import {
  VerificationError,
  createVeilRiskMidnightBinding,
  requestApprovedExplanation,
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
      ai: {
        explain: (packet) => invoke("ai", `Explanation for ${packet.policyName}`),
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

  test("AI receives a reconstructed disclosure packet without extra private fields", async () => {
    let received;
    const ai = {
      explain: async (packet) => {
        received = packet;
        return "Approved explanation";
      },
    };
    const untrustedPacket = {
      policyName: "Conservative mandate",
      compliant: true,
      disclosedViolations: [],
      userApprovedDetailLevel: "result-only",
      allocation: validAllocation,
    };

    assert.equal(await requestApprovedExplanation(ai, untrustedPacket), "Approved explanation");
    assert.deepEqual(received, {
      policyName: "Conservative mandate",
      compliant: true,
      disclosedViolations: [],
      userApprovedDetailLevel: "result-only",
    });
    assert.equal("allocation" in received, false);
  });

  test("an injected AI failure can be retried", async () => {
    let attempts = 0;
    const ai = {
      explain: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("AI unavailable");
        return "Recovered explanation";
      },
    };
    const packet = {
      policyName: "Conservative mandate",
      compliant: true,
      disclosedViolations: [],
      userApprovedDetailLevel: "result-only",
    };

    await assert.rejects(requestApprovedExplanation(ai, packet), /AI unavailable/);
    assert.equal(await requestApprovedExplanation(ai, packet), "Recovered explanation");
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
      "verifying-on-midnight",
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

  test("wallet and Midnight failures are explicit and retryable", async () => {
    for (const [failureKey, expectedStage] of [["connectError", "wallet"], ["submitError", "midnight"]]) {
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
