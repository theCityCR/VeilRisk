import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  VerificationError,
  requestApprovedExplanation,
  verifyPortfolio,
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
