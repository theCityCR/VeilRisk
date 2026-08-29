import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BASIS_POINTS_TOTAL,
  DEFAULT_POLICY,
  evaluatePortfolio,
  formatBasisPoints,
} from "../lib/risk.ts";
import { defaultPolicy, policyVectors } from "./fixtures/policy-vectors.mjs";

describe("TypeScript policy engine", () => {
  test("uses the same basis-point policy as the shared vectors", () => {
    assert.equal(BASIS_POINTS_TOTAL, 10_000);
    assert.deepEqual(DEFAULT_POLICY, defaultPolicy);
  });

  for (const vector of policyVectors) {
    test(vector.name, () => {
      const result = evaluatePortfolio(vector.allocation, vector.policy);

      assert.equal(result.passed, vector.passed);
      if (vector.failureId) {
        assert.deepEqual(result.failures.map(({ id }) => id), [vector.failureId]);
      } else {
        assert.deepEqual(result.failures, []);
      }
    });
  }

  test("rejects values outside the supported allocation domain", () => {
    for (const invalid of [-1, 10_001, 1.5, Number.NaN]) {
      const result = evaluatePortfolio(
        { cash: invalid, bonds: 0, equities: 0, speculative: 0 },
        DEFAULT_POLICY,
      );

      assert.equal(result.passed, false);
      assert.equal(result.failures[0].id, "range");
    }
  });

  test("rejects an invalid public policy configuration", () => {
    assert.throws(
      () => evaluatePortfolio(
        { cash: 1_500, bonds: 2_500, equities: 5_000, speculative: 1_000 },
        { ...DEFAULT_POLICY, maxSpeculative: 10_001 },
      ),
      /integer basis points between 0 and 10,000/,
    );
  });

  test("formats integer basis points without hiding one-basis-point precision", () => {
    assert.equal(formatBasisPoints(0), "0%");
    assert.equal(formatBasisPoints(1), "0.01%");
    assert.equal(formatBasisPoints(1_500), "15%");
    assert.equal(formatBasisPoints(1_501), "15.01%");
    assert.equal(formatBasisPoints(10_000), "100%");
  });
});
