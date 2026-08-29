import { Buffer } from "node:buffer";
import { access } from "node:fs/promises";
import {
  HDWallet,
  Roles,
  WalletFacade,
  ShieldedWallet,
  DustWallet,
  UnshieldedWallet,
  createKeystore,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  PublicKey as UnshieldedPublicKey,
  type UnshieldedKeystore,
} from "@midnight-ntwrk/wallet-sdk";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import * as bip39 from "@scure/bip39";
import { wordlist as english } from "@scure/bip39/wordlists/english.js";
import { firstValueFrom, filter, timeout } from "rxjs";
import { WebSocket } from "ws";
import type { LocalWalletSession } from "./local-preprod-deployment.ts";

const PREPROD = {
  indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
  indexerWebSocket: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
  node: "wss://rpc.preprod.midnight.network",
  proofServer: "http://127.0.0.1:6300",
  networkId: "preprod",
} as const;

type WalletContext = Readonly<{
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
  unshieldedSecretKey: Uint8Array;
}>;

export class HeadlessWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeadlessWalletError";
  }
}

const WALLET_SYNC_ATTEMPTS = 3;

function errorChainContains(cause: unknown, marker: string, depth = 0): boolean {
  if (depth >= 8 || !(cause instanceof Error)) return false;
  return cause.message.toLowerCase().includes(marker)
    || errorChainContains(cause.cause, marker, depth + 1);
}

function safeWalletSyncError(cause: unknown) {
  if (errorChainContains(cause, "values inserted non-linearly into dust commitment tree")) {
    return new HeadlessWalletError(
      "Preprod hit its known intermittent tDUST synchronization fault. No transaction was submitted; wait briefly and retry.",
    );
  }
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return new HeadlessWalletError(
      "The local wallet did not finish Preprod synchronization within three minutes. No transaction was submitted; retry when the network is stable.",
    );
  }
  return new HeadlessWalletError(
    "The Preprod RPC or indexer interrupted wallet synchronization. No transaction was submitted; retry the command.",
  );
}

export async function retryWalletSynchronization<T>(
  attempt: () => Promise<T>,
  report: (message: string) => void = () => {},
  maxAttempts = WALLET_SYNC_ATTEMPTS,
) {
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    try {
      return await attempt();
    } catch (cause) {
      if (cause instanceof HeadlessWalletError) throw cause;
      if (cause instanceof Error && cause.name === "TimeoutError") {
        throw safeWalletSyncError(cause);
      }
      if (attemptNumber === maxAttempts) throw safeWalletSyncError(cause);
      report(
        `Preprod wallet synchronization was interrupted; retrying locally (${attemptNumber + 1}/${maxAttempts})...`,
      );
    }
  }
  throw new HeadlessWalletError("The local Preprod wallet could not synchronize.");
}

export function requireDustBalance(balance: bigint) {
  if (balance <= 0n) {
    throw new HeadlessWalletError(
      "The wallet is synchronized but its tDUST tank is empty. Wait for tDUST generation, then retry.",
    );
  }
  return balance;
}

function normalizeMnemonic(recoveryPhrase: string) {
  const normalized = recoveryPhrase.trim().replace(/\s+/g, " ");
  if (!bip39.validateMnemonic(normalized, english)) {
    throw new HeadlessWalletError(
      "That recovery phrase is not a valid BIP-39 phrase. Nothing was submitted.",
    );
  }
  return normalized;
}

async function initializeWallet(recoveryPhrase: string): Promise<WalletContext> {
  const normalized = normalizeMnemonic(recoveryPhrase);
  const seed = Buffer.from(await bip39.mnemonicToSeed(normalized));

  try {
    const hdResult = HDWallet.fromSeed(seed);
    if (hdResult.type !== "seedOk") {
      throw new HeadlessWalletError("The local wallet could not be initialized. Nothing was submitted.");
    }

    const derived = hdResult.hdWallet
      .selectAccount(0)
      .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
      .deriveKeysAt(0);
    if (derived.type !== "keysDerived") {
      hdResult.hdWallet.clear();
      throw new HeadlessWalletError("The local wallet keys could not be derived. Nothing was submitted.");
    }
    hdResult.hdWallet.clear();

    const shieldedSeed = derived.keys[Roles.Zswap];
    const dustSeed = derived.keys[Roles.Dust];
    const unshieldedSecretKey = derived.keys[Roles.NightExternal];
    let shieldedSecretKeys: ledger.ZswapSecretKeys | undefined;
    let dustSecretKey: ledger.DustSecretKey | undefined;
    let wallet: WalletFacade | undefined;
    let initialized = false;

    try {
      const activeShieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(shieldedSeed);
      const activeDustSecretKey = ledger.DustSecretKey.fromSeed(dustSeed);
      shieldedSecretKeys = activeShieldedSecretKeys;
      dustSecretKey = activeDustSecretKey;
      const unshieldedKeystore = createKeystore(
        unshieldedSecretKey,
        PREPROD.networkId,
      );
      const indexerClientConnection = {
        indexerHttpUrl: PREPROD.indexer,
        indexerWsUrl: PREPROD.indexerWebSocket,
      };
      const relayURL = new URL(PREPROD.node);
      const provingServerUrl = new URL(PREPROD.proofServer);
      const shieldedConfig = {
        networkId: PREPROD.networkId,
        indexerClientConnection,
        provingServerUrl,
        relayURL,
        txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
      };
      const unshieldedConfig = {
        networkId: PREPROD.networkId,
        indexerClientConnection,
        txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
      };
      const dustConfig = {
        networkId: PREPROD.networkId,
        costParameters: {
          additionalFeeOverhead: 300_000_000_000_000n,
          feeBlocksMargin: 5,
        },
        indexerClientConnection,
        provingServerUrl,
        relayURL,
        txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
      };
      const configuration = { ...shieldedConfig, ...unshieldedConfig, ...dustConfig };
      wallet = await WalletFacade.init({
        configuration,
        shielded: () => ShieldedWallet(shieldedConfig).startWithSecretKeys(
          activeShieldedSecretKeys,
        ),
        unshielded: () => UnshieldedWallet(unshieldedConfig).startWithPublicKey(
          UnshieldedPublicKey.fromKeyStore(unshieldedKeystore),
        ),
        dust: () => DustWallet(dustConfig).startWithSecretKey(
          activeDustSecretKey,
          ledger.LedgerParameters.initialParameters().dust,
        ),
      });
      await wallet.start(activeShieldedSecretKeys, activeDustSecretKey);
      initialized = true;
      return {
        wallet,
        shieldedSecretKeys: activeShieldedSecretKeys,
        dustSecretKey: activeDustSecretKey,
        unshieldedKeystore,
        unshieldedSecretKey,
      };
    } finally {
      shieldedSeed.fill(0);
      dustSeed.fill(0);
      if (!initialized) {
        await wallet?.stop().catch(() => {});
        clearSecretMaterial(shieldedSecretKeys, dustSecretKey, unshieldedSecretKey);
      }
    }
  } finally {
    seed.fill(0);
  }
}

function clearSecretMaterial(
  shieldedSecretKeys: ledger.ZswapSecretKeys | undefined,
  dustSecretKey: ledger.DustSecretKey | undefined,
  unshieldedSecretKey: Uint8Array,
) {
  try {
    shieldedSecretKeys?.clear();
  } catch {
    // Cleanup errors are intentionally neither logged nor allowed to retain other keys.
  }
  try {
    dustSecretKey?.clear();
  } catch {
    // Cleanup errors are intentionally neither logged nor allowed to retain other keys.
  }
  unshieldedSecretKey.fill(0);
}

async function clearWalletContext(context: WalletContext) {
  await context.wallet.stop().catch(() => {});
  clearSecretMaterial(
    context.shieldedSecretKeys,
    context.dustSecretKey,
    context.unshieldedSecretKey,
  );
}

function createWalletProvider(context: WalletContext): WalletProvider & MidnightProvider {
  return {
    getCoinPublicKey: () => context.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => context.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: UnboundTransaction, ttl?: Date) {
      const recipe = await context.wallet.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys: context.shieldedSecretKeys,
          dustSecretKey: context.dustSecretKey,
        },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return await context.wallet.finalizeRecipe(recipe);
    },
    async submitTx(tx) {
      return await context.wallet.submitTransaction(tx);
    },
  };
}

export async function checkLocalDeploymentPrerequisites(compiledAssetsPath: string) {
  try {
    await Promise.all([
      access(compiledAssetsPath),
      fetch(PREPROD.proofServer, { signal: AbortSignal.timeout(5_000) }),
    ]);
  } catch {
    throw new HeadlessWalletError(
      "The local proof server is unavailable or the compiled contract assets are missing. Start the proof server and retry.",
    );
  }
}

export async function openHeadlessPreprodWallet(
  recoveryPhrase: string,
  compiledAssetsPath: string,
  report: (message: string) => void = () => {},
): Promise<LocalWalletSession> {
  setNetworkId(PREPROD.networkId);
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

  return await retryWalletSynchronization(async () => {
    let context: WalletContext | undefined;
    try {
      context = await initializeWallet(recoveryPhrase);
      const synchronizedState = await firstValueFrom(
        context.wallet.state().pipe(
          filter((state) => state.isSynced),
          timeout({ first: 180_000 }),
        ),
      );
      requireDustBalance(synchronizedState.dust?.balance(new Date()) ?? 0n);

      const walletProvider = createWalletProvider(context);
      const zkConfigProvider = new NodeZkConfigProvider(compiledAssetsPath);
      const providers = {
        publicDataProvider: indexerPublicDataProvider(
          PREPROD.indexer,
          PREPROD.indexerWebSocket,
        ),
        zkConfigProvider,
        proofProvider: httpClientProofProvider(PREPROD.proofServer, zkConfigProvider),
        walletProvider,
        midnightProvider: walletProvider,
      };

      return {
        providers,
        close: async () => {
          if (context) await clearWalletContext(context);
          context = undefined;
        },
      };
    } catch (cause) {
      if (context) await clearWalletContext(context);
      throw cause;
    }
  }, report);
}
