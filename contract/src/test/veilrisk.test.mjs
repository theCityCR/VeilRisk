import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultPolicy, policyVectors } from "../../../tests/fixtures/policy-vectors.mjs";
import { VeilRiskSimulator } from "./veilrisk-simulator.mjs";

const failure = (message) => new RegExp(`failed assert: ${message}`);
const toBigIntRecord = (record) => Object.fromEntries(
  Object.entries(record).map(([key, value]) => [key, BigInt(value)]),
);
const toSimulatorPolicy = (policy) => ({
  speculative: BigInt(policy.maxSpeculative),
  growth: BigInt(policy.maxGrowth),
  singleBucket: BigInt(policy.maxSingleBucket),
});

describe("VeilRisk Compact contract", () => {
  test("publishes the configured policy and starts with no proofs", () => {
    const simulator = new VeilRiskSimulator();

    assert.deepEqual(simulator.getLedger(), {
      maxSpeculativeBps: BigInt(defaultPolicy.maxSpeculative),
      maxGrowthBps: BigInt(defaultPolicy.maxGrowth),
      maxSingleBucketBps: BigInt(defaultPolicy.maxSingleBucket),
      successfulProofs: 0n,
    });
  });

  test("rejects constructor limits above 100 percent", () => {
    assert.throws(
      () => new VeilRiskSimulator({ speculative: 10_001n, growth: 7_000n, singleBucket: 6_000n }),
      failure("Speculative limit must be a percentage"),
    );
    assert.throws(
      () => new VeilRiskSimulator({ speculative: 2_000n, growth: 10_001n, singleBucket: 6_000n }),
      failure("Growth limit must be a percentage"),
    );
    assert.throws(
      () => new VeilRiskSimulator({ speculative: 2_000n, growth: 7_000n, singleBucket: 10_001n }),
      failure("Concentration limit must be a percentage"),
    );
  });

  for (const vector of policyVectors) {
    test(`shared vector: ${vector.name}`, () => {
      const simulator = new VeilRiskSimulator(toSimulatorPolicy(vector.policy));
      const allocation = toBigIntRecord(vector.allocation);

      if (vector.passed) {
        assert.equal(simulator.prove(allocation).successfulProofs, 1n);
      } else {
        assert.throws(() => simulator.prove(allocation), failure(vector.compactFailure));
        assert.equal(simulator.getLedger().successfulProofs, 0n);
      }
    });
  }
});
