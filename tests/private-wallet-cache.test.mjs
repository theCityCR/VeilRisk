import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EphemeralDeploymentPrivateStateProvider } from "../lib/ephemeral-deployment-private-state.ts";
import {
  derivePrivateWalletCacheKey,
  loadPrivateWalletCache,
  PrivateWalletCacheError,
  savePrivateWalletCache,
} from "../lib/private-wallet-cache.ts";

const PRIVATE_CACHE = {
  shielded: "private-shielded-state",
  unshielded: "private-unshielded-state",
  dust: "private-dust-state",
};

test("wallet sync cache is encrypted, owner-only, and recoverable with the same key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "veilrisk-wallet-cache-"));
  const cachePath = join(directory, "wallet.enc.json");
  const key = derivePrivateWalletCacheKey(new Uint8Array(64).fill(7));

  try {
    await savePrivateWalletCache(cachePath, PRIVATE_CACHE, key);
    const encoded = await readFile(cachePath, "utf8");

    assert.equal((await stat(cachePath)).mode & 0o777, 0o600);
    assert.doesNotMatch(encoded, /private-(shielded|unshielded|dust)-state/);
    assert.deepEqual(await loadPrivateWalletCache(cachePath, key), PRIVATE_CACHE);
  } finally {
    key.fill(0);
  }
});

test("missing, corrupted, and wrong-key caches recover without exposing private state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "veilrisk-wallet-cache-"));
  const cachePath = join(directory, "wallet.enc.json");
  const correctKey = derivePrivateWalletCacheKey(new Uint8Array(64).fill(1));
  const wrongKey = derivePrivateWalletCacheKey(new Uint8Array(64).fill(2));

  try {
    assert.equal(await loadPrivateWalletCache(cachePath, correctKey), null);
    await savePrivateWalletCache(cachePath, PRIVATE_CACHE, correctKey);
    await assert.rejects(loadPrivateWalletCache(cachePath, wrongKey), (error) => {
      assert.ok(error instanceof PrivateWalletCacheError);
      assert.doesNotMatch(error.message, /private-|shielded|unshielded|dust/);
      return true;
    });
    await writeFile(cachePath, "not encrypted JSON", "utf8");
    await assert.rejects(loadPrivateWalletCache(cachePath, correctKey), (error) => {
      assert.ok(error instanceof PrivateWalletCacheError);
      assert.doesNotMatch(error.message, /not encrypted JSON/);
      return true;
    });
  } finally {
    correctKey.fill(0);
    wrongKey.fill(0);
  }
});

test("deployment maintenance keys remain in memory and are discarded on close", async () => {
  const provider = new EphemeralDeploymentPrivateStateProvider();
  const address = "public-contract-address";
  const signingKey = { private: "maintenance-key" };

  provider.setContractAddress(address);
  await provider.setSigningKey(address, signingKey);
  assert.equal(await provider.getSigningKey(address), signingKey);

  await provider.clearSigningKeys();
  assert.equal(await provider.getSigningKey(address), null);
});
