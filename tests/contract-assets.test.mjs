import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { describe, test } from "node:test";

const generatedAssets = [
  "public/contract/veilrisk/keys/proveCompliance.prover",
  "public/contract/veilrisk/keys/proveCompliance.verifier",
  "public/contract/veilrisk/zkir/proveCompliance.bzkir",
  "public/contract/veilrisk/zkir/proveCompliance.zkir",
];

describe("browser Compact assets", () => {
  for (const path of generatedAssets) {
    test(`prepares ${path}`, async () => {
      assert.ok((await stat(path)).size > 0);
    });
  }
});
