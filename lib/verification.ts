import { ErrorCodes, type ConnectedAPI, type InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { createUnprovenCallTx } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import * as midnightLedger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import {
  createProofProvider,
  SucceedEntirely,
  type MidnightProvider,
  type WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { Contract as VeilRiskContract } from "../work/contract/veilrisk/contract/index.js";
import { evaluatePortfolio, type Allocation, type RiskPolicy } from "./risk.ts";

export type ProofArtifact = Readonly<{ opaqueProof: string }>;
export type SignedTransaction = Readonly<{ opaqueTransaction: string }>;
export type SubmittedTransaction = Readonly<{ transactionId: string }>;
export type FinalizedTransaction = Readonly<{
  transactionId: string;
  network: string;
  contractAddress: string;
}>;
export type PublicAttestation = Readonly<{
  transactionId: string;
  policyName: string;
  compliant: true;
}>;

export type DisclosurePacket = Readonly<{
  policyName: string;
  compliant: boolean;
  disclosedViolations: readonly string[];
  userApprovedDetailLevel: "result-only" | "category-guidance";
}>;

export type WalletPort = Readonly<{
  connect: () => Promise<void>;
  sign: (proof: ProofArtifact) => Promise<SignedTransaction>;
}>;
export type ProofProviderPort = Readonly<{
  generate: (input: Readonly<{ allocation: Allocation; policy: RiskPolicy }>) => Promise<ProofArtifact>;
}>;
export type TransactionPort = Readonly<{
  submit: (transaction: SignedTransaction) => Promise<SubmittedTransaction>;
  waitForFinalization: (transactionId: string) => Promise<FinalizedTransaction>;
}>;
export type IndexerPort = Readonly<{
  getPublicAttestation: (transactionId: string) => Promise<PublicAttestation>;
}>;
export type AiExplanationPort = Readonly<{
  explain: (packet: DisclosurePacket) => Promise<string>;
}>;

export type VerificationPorts = Readonly<{
  wallet: WalletPort;
  proofProvider: ProofProviderPort;
  transaction: TransactionPort;
  indexer: IndexerPort;
  ai: AiExplanationPort;
}>;

type VeilRiskGeneratedContract = VeilRiskContract<undefined>;
type MidnightProviders = object;
type FinalizedMidnightCall = Readonly<{
  public: Readonly<{ txId: string }>;
}>;
export type MidnightLifecycleState =
  | Readonly<{ status: "generating-proof" }>
  | Readonly<{ status: "awaiting-signature" }>
  | Readonly<{ status: "submitting" }>
  | Readonly<{ status: "submitted"; transactionId: string }>;
type MidnightCallOptions = Readonly<{
  compiledContract: object;
  contractAddress: string;
  circuitId: "proveCompliance";
  args: readonly [bigint, bigint, bigint, bigint];
}>;
type SubmitMidnightCall = (
  providers: MidnightProviders,
  options: MidnightCallOptions,
  onState: (state: MidnightLifecycleState) => void,
) => Promise<FinalizedMidnightCall>;

export type LaceFailureReason =
  | "unavailable"
  | "incompatible"
  | "permission-rejected"
  | "network-mismatch"
  | "disconnected"
  | "configuration-invalid"
  | "proof-provider-unavailable"
  | "signature-rejected"
  | "submission-rejected"
  | "unknown";

export type LaceConnectionSummary = Readonly<{
  walletName: string;
  apiVersion: string;
  network: string;
  proofMode: "wallet-delegated";
}>;

export type LaceConnectorPort = Readonly<{
  connect: () => Promise<LaceConnectionSummary>;
  checkConnection: () => Promise<LaceConnectionSummary>;
  getProviders: () => Promise<MidnightProviders>;
  clear: () => void;
}>;

export type LaceConnectorConfig = Readonly<{
  network: string;
  compiledAssetsBaseUrl: string;
  getWalletRegistry: () => Record<string, InitialAPI> | undefined;
  fetch: typeof globalThis.fetch;
}>;

export type MidnightBindingPort = Readonly<{
  connect: () => Promise<MidnightProviders>;
  submitCompliance: (
    providers: MidnightProviders,
    input: Readonly<{ allocation: Allocation; policy: RiskPolicy }>,
    onState?: (state: MidnightLifecycleState) => void,
  ) => Promise<FinalizedTransaction>;
}>;

export type MidnightBindingConfig = Readonly<{
  network: string;
  contractAddress: string;
  compiledAssetsBaseUrl: string;
  connect: () => Promise<MidnightProviders>;
  submit?: SubmitMidnightCall;
}>;

export type ExternalStage = "wallet" | "proof" | "signature" | "submission" | "finalization" | "indexer" | "midnight";
export type VerificationState =
  | Readonly<{ status: "invalid-locally"; failureIds: readonly string[] }>
  | Readonly<{ status: "wallet-connection-required" }>
  | MidnightLifecycleState
  | Readonly<{ status: "finalized"; attestation: PublicAttestation }>
  | Readonly<{ status: "failed"; stage: ExternalStage }>;

export type VerificationResult =
  | Readonly<{ status: "invalid-locally"; failureIds: readonly string[] }>
  | Readonly<{ status: "finalized"; attestation: PublicAttestation; transaction: FinalizedTransaction }>;

export class VerificationError extends Error {
  readonly stage: ExternalStage;

  constructor(stage: ExternalStage, cause: unknown) {
    super(`Verification failed during ${stage}.`, { cause });
    this.name = "VerificationError";
    this.stage = stage;
  }
}

export class MidnightLifecycleError extends Error {
  readonly stage: "proof" | "signature" | "submission" | "finalization";

  constructor(
    stage: "proof" | "signature" | "submission" | "finalization",
    cause: unknown,
  ) {
    super(`Midnight transaction failed during ${stage}.`, { cause });
    this.name = "MidnightLifecycleError";
    this.stage = stage;
  }
}

export class LaceConnectorError extends Error {
  readonly reason: LaceFailureReason;

  constructor(reason: LaceFailureReason, cause?: unknown) {
    super(`Lace connection failed: ${reason}.`, { cause });
    this.name = "LaceConnectorError";
    this.reason = reason;
  }
}

export function getLaceFailureMessage(reason: LaceFailureReason) {
  switch (reason) {
    case "unavailable":
      return "Lace was not found. Install or enable the Midnight Lace extension, then retry.";
    case "incompatible":
      return "The detected wallet does not support the required Lace connector API version 4.";
    case "permission-rejected":
      return "Wallet authorization was rejected. You can retry when you are ready.";
    case "network-mismatch":
      return "Lace is connected to a different network. Switch it to Preprod, then retry.";
    case "disconnected":
      return "The Lace connection was lost. Reconnect the wallet to continue.";
    case "configuration-invalid":
      return "Lace returned incomplete network configuration. Check the wallet network settings.";
    case "proof-provider-unavailable":
      return "Lace could not configure its proving provider. Check its proof settings, then retry.";
    case "signature-rejected":
      return "The wallet signature was rejected. No transaction was submitted; you can retry.";
    case "submission-rejected":
      return "Lace rejected transaction submission. Review the wallet state, then retry.";
    default:
      return "Lace could not be connected. Check the wallet and retry.";
  }
}

function connectorCode(cause: unknown) {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  return String(cause.code);
}

function connectionFailure(cause: unknown) {
  const code = connectorCode(cause);
  if (code === ErrorCodes.PermissionRejected || code === ErrorCodes.Rejected) {
    return new LaceConnectorError("permission-rejected", cause);
  }
  if (code === ErrorCodes.Disconnected) {
    return new LaceConnectorError("disconnected", cause);
  }
  return new LaceConnectorError("unknown", cause);
}

function transactionFailure(
  cause: unknown,
  rejectedReason: "signature-rejected" | "submission-rejected",
) {
  const code = connectorCode(cause);
  if (code === ErrorCodes.PermissionRejected || code === ErrorCodes.Rejected) {
    return new LaceConnectorError(rejectedReason, cause);
  }
  if (code === ErrorCodes.Disconnected) {
    return new LaceConnectorError("disconnected", cause);
  }
  return cause;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(value)) {
    throw new LaceConnectorError("configuration-invalid");
  }
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function sanitizeWalletLabel(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length === 0 ? "Midnight wallet" : normalized.slice(0, 80);
}

function requireServiceUrl(value: string, protocols: readonly string[]) {
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) throw new Error("Unsupported protocol");
    return url.toString();
  } catch (cause) {
    throw new LaceConnectorError("configuration-invalid", cause);
  }
}

async function requireConnected(wallet: ConnectedAPI, network: string) {
  let status;
  try {
    status = await wallet.getConnectionStatus();
  } catch (cause) {
    throw connectionFailure(cause);
  }
  if (status.status !== "connected") {
    throw new LaceConnectorError("disconnected");
  }
  if (status.networkId !== network) {
    throw new LaceConnectorError("network-mismatch");
  }
}

export function createLaceConnector(config: LaceConnectorConfig): LaceConnectorPort {
  const network = requirePublicIdentifier(config.network, "Midnight network").toLowerCase();
  const compiledAssetsBaseUrl = requirePublicIdentifier(
    config.compiledAssetsBaseUrl,
    "Compiled asset base URL",
  ).replace(/\/$/, "");
  let wallet: ConnectedAPI | undefined;
  let providers: MidnightProviders | undefined;
  let summary: LaceConnectionSummary | undefined;

  const clear = () => {
    wallet = undefined;
    providers = undefined;
    summary = undefined;
  };

  const checkConnection = async () => {
    if (!wallet || !summary) throw new LaceConnectorError("disconnected");
    try {
      await requireConnected(wallet, network);
      return summary;
    } catch (cause) {
      clear();
      throw cause;
    }
  };

  const connect = async () => {
    clear();
    const registry = config.getWalletRegistry();
    const candidates = registry ? Object.entries(registry) : [];
    const selected = candidates.find(([key]) => key === "mnLace")?.[1]
      ?? candidates.find(([, api]) => /lace/i.test(`${api.rdns} ${api.name}`))?.[1];
    if (!selected) throw new LaceConnectorError("unavailable");
    if (Number.parseInt(selected.apiVersion.split(".")[0] ?? "", 10) !== 4) {
      throw new LaceConnectorError("incompatible");
    }

    let connected: ConnectedAPI;
    try {
      connected = await selected.connect(network);
      await requireConnected(connected, network);
      await connected.hintUsage([
        "getShieldedAddresses",
        "getProvingProvider",
        "balanceUnsealedTransaction",
        "submitTransaction",
      ]);
    } catch (cause) {
      if (cause instanceof LaceConnectorError) throw cause;
      throw connectionFailure(cause);
    }

    const walletConfig = await connected.getConfiguration().catch((cause) => {
      throw connectionFailure(cause);
    });
    if (walletConfig.networkId !== network) {
      throw new LaceConnectorError("network-mismatch");
    }
    const indexerUri = requireServiceUrl(walletConfig.indexerUri, ["http:", "https:"]);
    const indexerWsUri = requireServiceUrl(walletConfig.indexerWsUri, ["ws:", "wss:"]);
    requireServiceUrl(walletConfig.substrateNodeUri, ["http:", "https:", "ws:", "wss:"]);

    const addresses = await connected.getShieldedAddresses().catch((cause) => {
      throw connectionFailure(cause);
    });
    if (!addresses.shieldedCoinPublicKey.trim() || !addresses.shieldedEncryptionPublicKey.trim()) {
      throw new LaceConnectorError("configuration-invalid");
    }

    setNetworkId(network);
    const zkConfigProvider = new FetchZkConfigProvider<"proveCompliance">(
      compiledAssetsBaseUrl,
      config.fetch,
    );
    let proofProvider;
    try {
      const provingProvider = await connected.getProvingProvider(
        zkConfigProvider.asKeyMaterialProvider(),
      );
      proofProvider = createProofProvider(provingProvider);
    } catch (cause) {
      const code = connectorCode(cause);
      if (code === ErrorCodes.PermissionRejected || code === ErrorCodes.Rejected) {
        throw new LaceConnectorError("permission-rejected", cause);
      }
      if (code === ErrorCodes.Disconnected) {
        throw new LaceConnectorError("disconnected", cause);
      }
      throw new LaceConnectorError("proof-provider-unavailable", cause);
    }

    const walletProvider: WalletProvider = {
      getCoinPublicKey: () => addresses.shieldedCoinPublicKey as midnightLedger.CoinPublicKey,
      getEncryptionPublicKey: () => addresses.shieldedEncryptionPublicKey as midnightLedger.EncPublicKey,
      async balanceTx(tx) {
        try {
          await requireConnected(connected, network);
          const result = await connected.balanceUnsealedTransaction(
            bytesToHex(tx.serialize()),
            { payFees: true },
          );
          return midnightLedger.Transaction.deserialize(
            "signature",
            "proof",
            "binding",
            hexToBytes(result.tx),
          ) as midnightLedger.FinalizedTransaction;
        } catch (cause) {
          throw transactionFailure(cause, "signature-rejected");
        }
      },
    };

    const midnightProvider: MidnightProvider = {
      async submitTx(tx) {
        try {
          await requireConnected(connected, network);
          await connected.submitTransaction(bytesToHex(tx.serialize()));
          const transactionId = tx.identifiers()[0];
          if (!transactionId) throw new Error("Finalized transaction has no identifier.");
          return transactionId;
        } catch (cause) {
          throw transactionFailure(cause, "submission-rejected");
        }
      },
    };

    wallet = connected;
    providers = {
      zkConfigProvider,
      proofProvider,
      publicDataProvider: indexerPublicDataProvider(indexerUri, indexerWsUri),
      walletProvider,
      midnightProvider,
    };
    summary = {
      walletName: sanitizeWalletLabel(selected.name),
      apiVersion: selected.apiVersion,
      network,
      proofMode: "wallet-delegated",
    };
    return summary;
  };

  return {
    connect,
    checkConnection,
    async getProviders() {
      await checkConnection();
      if (!providers) throw new LaceConnectorError("disconnected");
      return providers;
    },
    clear,
  };
}

export function createBrowserLaceConnector(
  network = "preprod",
  compiledAssetsBaseUrl = `${globalThis.location.origin}/contract/veilrisk`,
) {
  return createLaceConnector({
    network,
    compiledAssetsBaseUrl,
    getWalletRegistry: () => (
      globalThis as typeof globalThis & { midnight?: Record<string, InitialAPI> }
    ).midnight,
    fetch: globalThis.fetch.bind(globalThis),
  });
}

function findLaceConnectorError(cause: unknown, depth = 0): LaceConnectorError | undefined {
  if (cause instanceof LaceConnectorError) return cause;
  if (depth >= 4 || !(cause instanceof Error)) return undefined;
  return findLaceConnectorError(cause.cause, depth + 1);
}

function stageForMidnightFailure(cause: unknown): ExternalStage {
  if (cause instanceof MidnightLifecycleError) return cause.stage;
  switch (findLaceConnectorError(cause)?.reason) {
    case "signature-rejected":
      return "signature";
    case "submission-rejected":
      return "submission";
    case "disconnected":
      return "wallet";
    case "proof-provider-unavailable":
      return "proof";
    default:
      return "midnight";
  }
}

export function getVerificationFailureMessage(cause: unknown) {
  const laceError = findLaceConnectorError(cause);
  if (laceError) return getLaceFailureMessage(laceError.reason);

  const stage = cause instanceof VerificationError ? cause.stage : "midnight";
  switch (stage) {
    case "proof":
      return "Proof generation failed. Check Lace's proving service and retry. No transaction was submitted.";
    case "signature":
      return "Lace did not approve the transaction. No transaction was submitted; you can retry.";
    case "submission":
      return "The transaction could not be submitted. Check Lace and your tDUST balance, then retry.";
    case "finalization":
    case "indexer":
      return "The transaction was submitted but could not be confirmed by the Preprod indexer. Keep the transaction ID shown and retry inspection.";
    case "wallet":
      return "Lace could not be connected. Check the wallet and retry.";
    default:
      return "Midnight could not prepare the compliance transaction. No verified attestation was produced.";
  }
}

function requirePublicIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
  return normalized;
}

type PreparedMidnightCall = Readonly<{ private: Readonly<{ unprovenTx: unknown }> }>;
type LifecycleProviders = Readonly<{
  proofProvider: Readonly<{ proveTx: (transaction: never) => Promise<unknown> }>;
  walletProvider: Readonly<{ balanceTx: (transaction: never) => Promise<unknown> }>;
  midnightProvider: Readonly<{ submitTx: (transaction: never) => Promise<string> }>;
  publicDataProvider: Readonly<{
    watchForTxData: (transactionId: string) => Promise<Readonly<{
      status: unknown;
      identifiers: readonly string[];
    }>>;
  }>;
}>;

export async function runMidnightCallLifecycle(
  providers: LifecycleProviders,
  prepare: () => Promise<PreparedMidnightCall>,
  onState: (state: MidnightLifecycleState) => void = () => {},
): Promise<FinalizedMidnightCall> {
  let stage: MidnightLifecycleError["stage"] = "proof";
  try {
    const prepared = await prepare();
    const proven = await providers.proofProvider.proveTx(
      prepared.private.unprovenTx as never,
    );

    stage = "signature";
    onState({ status: "awaiting-signature" });
    const balanced = await providers.walletProvider.balanceTx(proven as never);

    stage = "submission";
    onState({ status: "submitting" });
    const transactionId = requirePublicIdentifier(
      await providers.midnightProvider.submitTx(balanced as never),
      "Transaction ID",
    );
    onState({ status: "submitted", transactionId });

    stage = "finalization";
    const finalized = await providers.publicDataProvider.watchForTxData(transactionId);
    if (
      finalized.status !== SucceedEntirely
      || !finalized.identifiers.includes(transactionId)
    ) {
      throw new Error("Indexer did not confirm a successful matching transaction.");
    }
    return { public: { txId: transactionId } };
  } catch (cause) {
    if (cause instanceof MidnightLifecycleError) throw cause;
    throw new MidnightLifecycleError(stage, cause);
  }
}

const submitGeneratedCall: SubmitMidnightCall = async (providers, options, onState) => {
  return await runMidnightCallLifecycle(
    providers as LifecycleProviders,
    async () => await createUnprovenCallTx(
      providers as never,
      options as never,
    ) as PreparedMidnightCall,
    onState,
  );
};

export function createVeilRiskMidnightBinding(
  config: MidnightBindingConfig,
): MidnightBindingPort {
  const network = requirePublicIdentifier(config.network, "Midnight network");
  const contractAddress = requirePublicIdentifier(config.contractAddress, "Contract address");
  const compiledAssetsBaseUrl = requirePublicIdentifier(
    config.compiledAssetsBaseUrl,
    "Compiled asset base URL",
  ).replace(/\/$/, "");
  const submit = config.submit ?? submitGeneratedCall;
  const compiledContract = CompiledContract.make<VeilRiskGeneratedContract>(
    "VeilRisk",
    VeilRiskContract,
  ).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(compiledAssetsBaseUrl),
  );

  return {
    connect: config.connect,
    async submitCompliance(providers, input, onState = () => {}) {
      if (!evaluatePortfolio(input.allocation, input.policy).passed) {
        throw new RangeError("Invalid portfolios cannot be submitted to Midnight.");
      }

      let stage: MidnightLifecycleError["stage"] = "proof";
      const forwardState = (state: MidnightLifecycleState) => {
        if (state.status === "awaiting-signature") stage = "signature";
        if (state.status === "submitting") stage = "submission";
        if (state.status === "submitted") stage = "finalization";
        onState(state);
      };

      onState({ status: "generating-proof" });
      let finalized: FinalizedMidnightCall;
      try {
        finalized = await submit(providers, {
          compiledContract,
          contractAddress,
          circuitId: "proveCompliance",
          args: [
            BigInt(input.allocation.cash),
            BigInt(input.allocation.bonds),
            BigInt(input.allocation.equities),
            BigInt(input.allocation.speculative),
          ],
        }, forwardState);
      } catch (cause) {
        if (cause instanceof MidnightLifecycleError || cause instanceof LaceConnectorError) {
          throw cause;
        }
        throw new MidnightLifecycleError(stage, cause);
      }

      return {
        transactionId: requirePublicIdentifier(finalized.public.txId, "Transaction ID"),
        network,
        contractAddress,
      };
    },
  };
}

export async function verifyPortfolioOnMidnight(
  midnight: MidnightBindingPort,
  input: Readonly<{ allocation: Allocation; policy: RiskPolicy; policyName: string }>,
  onState: (state: VerificationState) => void = () => {},
): Promise<VerificationResult> {
  const evaluation = evaluatePortfolio(input.allocation, input.policy);
  if (!evaluation.passed) {
    const result = {
      status: "invalid-locally" as const,
      failureIds: evaluation.failures.map(({ id }) => id),
    };
    onState(result);
    return result;
  }

  let providers: MidnightProviders;
  try {
    onState({ status: "wallet-connection-required" });
    providers = await midnight.connect();
  } catch (cause) {
    onState({ status: "failed", stage: "wallet" });
    throw new VerificationError("wallet", cause);
  }

  try {
    const transaction = await midnight.submitCompliance(providers, input, onState);
    const attestation: PublicAttestation = {
      transactionId: transaction.transactionId,
      policyName: input.policyName,
      compliant: true,
    };
    const result = { status: "finalized" as const, attestation, transaction };
    onState({ status: "finalized", attestation });
    return result;
  } catch (cause) {
    const stage = stageForMidnightFailure(cause);
    onState({ status: "failed", stage });
    throw new VerificationError(stage, cause);
  }
}

export async function verifyPortfolio(
  ports: VerificationPorts,
  input: Readonly<{ allocation: Allocation; policy: RiskPolicy }>,
  onState: (state: VerificationState) => void = () => {},
): Promise<VerificationResult> {
  const evaluation = evaluatePortfolio(input.allocation, input.policy);
  if (!evaluation.passed) {
    const result = {
      status: "invalid-locally" as const,
      failureIds: evaluation.failures.map(({ id }) => id),
    };
    onState(result);
    return result;
  }

  let stage: ExternalStage = "wallet";
  try {
    onState({ status: "wallet-connection-required" });
    await ports.wallet.connect();

    stage = "proof";
    onState({ status: "generating-proof" });
    const proof = await ports.proofProvider.generate(input);

    stage = "signature";
    onState({ status: "awaiting-signature" });
    const signedTransaction = await ports.wallet.sign(proof);

    stage = "submission";
    const submitted = await ports.transaction.submit(signedTransaction);
    onState({ status: "submitted", transactionId: submitted.transactionId });

    stage = "finalization";
    const transaction = await ports.transaction.waitForFinalization(submitted.transactionId);

    stage = "indexer";
    const attestation = await ports.indexer.getPublicAttestation(transaction.transactionId);
    if (attestation.transactionId !== transaction.transactionId) {
      throw new Error("Indexer returned an attestation for a different transaction.");
    }

    const result = { status: "finalized" as const, attestation, transaction };
    onState({ status: "finalized", attestation });
    return result;
  } catch (cause) {
    onState({ status: "failed", stage });
    throw new VerificationError(stage, cause);
  }
}

export async function requestApprovedExplanation(
  ai: AiExplanationPort,
  packet: DisclosurePacket,
) {
  const approvedPacket: DisclosurePacket = {
    policyName: packet.policyName,
    compliant: packet.compliant,
    disclosedViolations: [...packet.disclosedViolations],
    userApprovedDetailLevel: packet.userApprovedDetailLevel,
  };
  return ai.explain(approvedPacket);
}
