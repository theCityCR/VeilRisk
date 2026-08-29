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

export type ExternalStage = "wallet" | "proof" | "signature" | "submission" | "finalization" | "indexer";
export type VerificationState =
  | Readonly<{ status: "invalid-locally"; failureIds: readonly string[] }>
  | Readonly<{ status: "wallet-connection-required" }>
  | Readonly<{ status: "generating-proof" }>
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
