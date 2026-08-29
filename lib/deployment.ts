import { deployContract, getPublicStates } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import type { ChargedState, StateValue } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import {
  Contract as VeilRiskContract,
  ledger as readVeilRiskLedger,
} from "../contract/src/managed/veilrisk/contract/index.js";
import { BASIS_POINTS_TOTAL, type RiskPolicy } from "./risk.ts";
import {
  getLaceFailureMessage,
  LaceConnectorError,
  type LaceFailureReason,
} from "./verification.ts";

type VeilRiskGeneratedContract = VeilRiskContract<undefined>;
type MidnightProviders = Readonly<{ publicDataProvider: PublicDataProvider }> & object;

type PublicDeployData = Readonly<{
  contractAddress: string;
  txId: string;
}>;

type DeployResult = Readonly<{
  deployTxData: Readonly<{ public: PublicDeployData }>;
}>;

type DeployOptions = Readonly<{
  compiledContract: object;
  args: readonly [bigint, bigint, bigint];
}>;

type DeployContractPort = (
  providers: MidnightProviders,
  options: DeployOptions,
) => Promise<DeployResult>;

type ReadPublicContractStatePort = (
  providers: MidnightProviders,
  contractAddress: string,
) => Promise<StateValue | ChargedState>;

export type DeploymentReceipt = Readonly<{
  network: "preprod";
  contractAddress: string;
  transactionId: string;
  policy: RiskPolicy;
}>;

export type VerifiedDeployment = DeploymentReceipt & Readonly<{
  publicStateVerified: true;
}>;

export type DeploymentState =
  | Readonly<{ status: "connecting-wallet" }>
  | Readonly<{ status: "awaiting-deployment" }>
  | Readonly<{ status: "verifying-public-state"; receipt: DeploymentReceipt }>
  | Readonly<{ status: "finalized"; deployment: VerifiedDeployment }>
  | Readonly<{ status: "failed"; stage: "wallet" | "deployment" | "public-state" }>;

export class DeploymentError extends Error {
  readonly stage: "wallet" | "deployment" | "public-state";
  readonly receipt?: DeploymentReceipt;

  constructor(
    stage: "wallet" | "deployment" | "public-state",
    cause: unknown,
    receipt?: DeploymentReceipt,
  ) {
    super(`Contract deployment failed during ${stage}.`, { cause });
    this.name = "DeploymentError";
    this.stage = stage;
    this.receipt = receipt;
  }
}

function findLaceFailureReason(cause: unknown, depth = 0): LaceFailureReason | undefined {
  if (cause instanceof LaceConnectorError) return cause.reason;
  if (depth >= 6 || !(cause instanceof Error)) return undefined;
  return findLaceFailureReason(cause.cause, depth + 1);
}

export function getDeploymentFailureMessage(cause: unknown) {
  const laceReason = findLaceFailureReason(cause);
  if (laceReason) return getLaceFailureMessage(laceReason);

  if (cause instanceof DeploymentError) {
    if (cause.receipt) {
      return "The transaction finalized, but its indexed public policy could not be confirmed. Keep the public identifiers below and retry inspection before using this contract.";
    }
    if (cause.stage === "deployment") {
      return "Lace could not generate, balance, or submit the deployment. Check its Preprod funds and proving service, then retry.";
    }
  }

  return "No verified deployment was produced. Check Lace, its Preprod balance, and the configured proving service, then retry.";
}

export type VeilRiskDeploymentConfig = Readonly<{
  network: "preprod";
  compiledAssetsBaseUrl: string;
  connect: () => Promise<MidnightProviders>;
  deploy?: DeployContractPort;
  readPublicContractState?: ReadPublicContractStatePort;
}>;

function requirePublicIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${label} must not be empty.`);
  return normalized;
}

export function validateDeploymentPolicy(policy: RiskPolicy) {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value < 0 || value > BASIS_POINTS_TOTAL) {
      throw new RangeError(`${name} must be integer basis points between 0 and 10,000.`);
    }
  }
  return policy;
}

function policiesMatch(actual: RiskPolicy, expected: RiskPolicy) {
  return actual.maxSpeculative === expected.maxSpeculative
    && actual.maxGrowth === expected.maxGrowth
    && actual.maxSingleBucket === expected.maxSingleBucket;
}

const deployGeneratedContract: DeployContractPort = async (providers, options) => {
  return deployContract(
    providers as never,
    options as never,
  ) as Promise<DeployResult>;
};

const readIndexedPublicState: ReadPublicContractStatePort = async (providers, contractAddress) => {
  const states = await getPublicStates(
    providers.publicDataProvider,
    contractAddress as never,
  );
  return states.contractState.data;
};

export function createVeilRiskDeployment(config: VeilRiskDeploymentConfig) {
  const compiledAssetsBaseUrl = requirePublicIdentifier(
    config.compiledAssetsBaseUrl,
    "Compiled asset base URL",
  ).replace(/\/$/, "");
  const deploy = config.deploy ?? deployGeneratedContract;
  const readPublicContractState = config.readPublicContractState ?? readIndexedPublicState;
  const compiledContract = CompiledContract.make<VeilRiskGeneratedContract>(
    "VeilRisk",
    VeilRiskContract,
  ).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(compiledAssetsBaseUrl),
  );

  return async function deployPolicy(
    policy: RiskPolicy,
    onState: (state: DeploymentState) => void = () => {},
  ): Promise<VerifiedDeployment> {
    validateDeploymentPolicy(policy);

    let providers: MidnightProviders;
    try {
      onState({ status: "connecting-wallet" });
      providers = await config.connect();
    } catch (cause) {
      onState({ status: "failed", stage: "wallet" });
      throw new DeploymentError("wallet", cause);
    }

    let receipt: DeploymentReceipt;
    try {
      onState({ status: "awaiting-deployment" });
      const deployed = await deploy(providers, {
        compiledContract,
        args: [
          BigInt(policy.maxSpeculative),
          BigInt(policy.maxGrowth),
          BigInt(policy.maxSingleBucket),
        ],
      });
      receipt = {
        network: config.network,
        contractAddress: requirePublicIdentifier(
          deployed.deployTxData.public.contractAddress,
          "Contract address",
        ),
        transactionId: requirePublicIdentifier(
          deployed.deployTxData.public.txId,
          "Deployment transaction ID",
        ),
        policy: { ...policy },
      };
    } catch (cause) {
      onState({ status: "failed", stage: "deployment" });
      throw new DeploymentError("deployment", cause);
    }

    try {
      onState({ status: "verifying-public-state", receipt });
      const state = await readPublicContractState(providers, receipt.contractAddress);
      const ledger = readVeilRiskLedger(state);
      const indexedPolicy: RiskPolicy = {
        maxSpeculative: Number(ledger.maxSpeculativeBps),
        maxGrowth: Number(ledger.maxGrowthBps),
        maxSingleBucket: Number(ledger.maxSingleBucketBps),
      };
      if (!policiesMatch(indexedPolicy, policy) || ledger.successfulProofs !== 0n) {
        throw new Error("Indexed public state does not match the deployment profile.");
      }

      const deployment = { ...receipt, publicStateVerified: true as const };
      onState({ status: "finalized", deployment });
      return deployment;
    } catch (cause) {
      onState({ status: "failed", stage: "public-state" });
      throw new DeploymentError("public-state", cause, receipt);
    }
  };
}
