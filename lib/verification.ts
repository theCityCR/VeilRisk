import { submitCallTx } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { Contract as VeilRiskContract } from "../contract/src/managed/veilrisk/contract/index.js";
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
type MidnightCallOptions = Readonly<{
  compiledContract: object;
  contractAddress: string;
  circuitId: "proveCompliance";
  args: readonly [bigint, bigint, bigint, bigint];
}>;
type SubmitMidnightCall = (
  providers: MidnightProviders,
  options: MidnightCallOptions,
) => Promise<FinalizedMidnightCall>;

export type MidnightBindingPort = Readonly<{
  connect: () => Promise<MidnightProviders>;
  submitCompliance: (
    providers: MidnightProviders,
    input: Readonly<{ allocation: Allocation; policy: RiskPolicy }>,
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
  | Readonly<{ status: "generating-proof" }>
  | Readonly<{ status: "verifying-on-midnight" }>
  | Readonly<{ status: "awaiting-signature" }>
  | Readonly<{ status: "submitted"; transactionId: string }>
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

function requirePublicIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
  return normalized;
}

const submitGeneratedCall: SubmitMidnightCall = async (providers, options) => {
  const result = await submitCallTx(
    providers as never,
    options as never,
  ) as FinalizedMidnightCall;
  return result;
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
    async submitCompliance(providers, input) {
      if (!evaluatePortfolio(input.allocation, input.policy).passed) {
        throw new RangeError("Invalid portfolios cannot be submitted to Midnight.");
      }

      const finalized = await submit(providers, {
        compiledContract,
        contractAddress,
        circuitId: "proveCompliance",
        args: [
          BigInt(input.allocation.cash),
          BigInt(input.allocation.bonds),
          BigInt(input.allocation.equities),
          BigInt(input.allocation.speculative),
        ],
      });

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
    onState({ status: "verifying-on-midnight" });
    const transaction = await midnight.submitCompliance(providers, input);
    const attestation: PublicAttestation = {
      transactionId: transaction.transactionId,
      policyName: input.policyName,
      compliant: true,
    };
    const result = { status: "finalized" as const, attestation, transaction };
    onState({ status: "finalized", attestation });
    return result;
  } catch (cause) {
    onState({ status: "failed", stage: "midnight" });
    throw new VerificationError("midnight", cause);
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
