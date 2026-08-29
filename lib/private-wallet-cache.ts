import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type PrivateWalletCache = Readonly<{
  shielded: string;
  unshielded: string;
  dust: string;
}>;

type EncryptedWalletCache = Readonly<{
  version: 1;
  iv: string;
  authenticationTag: string;
  ciphertext: string;
}>;

export class PrivateWalletCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateWalletCacheError";
  }
}

export function derivePrivateWalletCacheKey(seed: Uint8Array) {
  return createHash("sha256")
    .update("VeilRisk local Preprod wallet cache v1\0", "utf8")
    .update(seed)
    .digest();
}

function requirePrivateWalletCache(value: unknown): PrivateWalletCache {
  if (
    typeof value !== "object"
    || value === null
    || !("shielded" in value)
    || !("unshielded" in value)
    || !("dust" in value)
    || typeof value.shielded !== "string"
    || typeof value.unshielded !== "string"
    || typeof value.dust !== "string"
  ) {
    throw new PrivateWalletCacheError("The encrypted wallet sync cache is invalid.");
  }
  return {
    shielded: value.shielded,
    unshielded: value.unshielded,
    dust: value.dust,
  };
}

export async function loadPrivateWalletCache(
  cachePath: string,
  encryptionKey: Uint8Array,
) {
  let encoded: string;
  try {
    encoded = await readFile(cachePath, "utf8");
  } catch (cause) {
    if (
      typeof cause === "object"
      && cause !== null
      && "code" in cause
      && cause.code === "ENOENT"
    ) return null;
    throw new PrivateWalletCacheError("The encrypted wallet sync cache could not be read.");
  }

  try {
    const encrypted = JSON.parse(encoded) as EncryptedWalletCache;
    if (
      encrypted.version !== 1
      || typeof encrypted.iv !== "string"
      || typeof encrypted.authenticationTag !== "string"
      || typeof encrypted.ciphertext !== "string"
    ) throw new Error("Invalid cache envelope.");

    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(encrypted.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(encrypted.authenticationTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]);
    try {
      return requirePrivateWalletCache(JSON.parse(plaintext.toString("utf8")));
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new PrivateWalletCacheError(
      "The encrypted wallet sync cache did not match this recovery phrase or was invalid.",
    );
  }
}

export async function savePrivateWalletCache(
  cachePath: string,
  cache: PrivateWalletCache,
  encryptionKey: Uint8Array,
) {
  const plaintext = Buffer.from(JSON.stringify(cache), "utf8");
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const encrypted: EncryptedWalletCache = {
      version: 1,
      iv: iv.toString("base64"),
      authenticationTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    const temporaryPath = `${cachePath}.pending`;
    const cacheDirectory = dirname(cachePath);
    await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
    await chmod(cacheDirectory, 0o700);
    await writeFile(temporaryPath, `${JSON.stringify(encrypted)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, cachePath);
    await chmod(cachePath, 0o600);
    ciphertext.fill(0);
  } catch {
    throw new PrivateWalletCacheError("The encrypted wallet sync cache could not be saved.");
  } finally {
    plaintext.fill(0);
    iv.fill(0);
  }
}
