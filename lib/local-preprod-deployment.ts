import { rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MidnightProviders, VerifiedDeployment } from "./deployment.ts";
import { DEFAULT_POLICY } from "./risk.ts";

export type LocalWalletSession = Readonly<{
  providers: MidnightProviders;
  close: () => Promise<void>;
}>;

export type LocalDeploymentCommandDependencies = Readonly<{
  preflight: () => Promise<void>;
  readRecoveryPhrase: () => Promise<string>;
  openWallet: (recoveryPhrase: string) => Promise<LocalWalletSession>;
  deployPolicy: (
    session: LocalWalletSession,
    report: (message: string) => void,
  ) => Promise<VerifiedDeployment>;
  persistReceipt: (deployment: VerifiedDeployment) => Promise<void>;
  report?: (message: string) => void;
}>;

export type PublicDeploymentRecord = Readonly<{
  network: "preprod";
  policyName: "Conservative mandate";
  policy: typeof DEFAULT_POLICY;
  contractAddress: string;
  deploymentTransactionId: string;
  publicStateVerified: true;
}>;

export class LocalDeploymentCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalDeploymentCommandError";
  }
}

export function createPublicDeploymentRecord(
  deployment: VerifiedDeployment,
): PublicDeploymentRecord {
  const policyMatches = deployment.policy.maxSpeculative === DEFAULT_POLICY.maxSpeculative
    && deployment.policy.maxGrowth === DEFAULT_POLICY.maxGrowth
    && deployment.policy.maxSingleBucket === DEFAULT_POLICY.maxSingleBucket;
  if (
    deployment.network !== "preprod"
    || deployment.publicStateVerified !== true
    || !policyMatches
  ) {
    throw new LocalDeploymentCommandError(
      "The deployment receipt was not verified for the fixed Preprod policy; no record was saved.",
    );
  }

  return {
    network: "preprod",
    policyName: "Conservative mandate",
    policy: { ...DEFAULT_POLICY },
    contractAddress: deployment.contractAddress,
    deploymentTransactionId: deployment.transactionId,
    publicStateVerified: true,
  };
}

export async function writePublicDeploymentRecord(
  recordPath: string,
  deployment: VerifiedDeployment,
) {
  const record = createPublicDeploymentRecord(deployment);
  const temporaryPath = `${recordPath}.pending`;
  const body = `${JSON.stringify(record, null, 2)}\n`;

  try {
    await writeFile(temporaryPath, body, { encoding: "utf8", mode: 0o644 });
    await rename(temporaryPath, recordPath);
  } catch {
    throw new LocalDeploymentCommandError(
      `The verified public receipt could not be saved in ${dirname(recordPath)}.`,
    );
  }
}

export async function runLocalPreprodDeployment(
  dependencies: LocalDeploymentCommandDependencies,
) {
  const report = dependencies.report ?? (() => {});
  let recoveryPhrase = "";
  let session: LocalWalletSession | undefined;

  try {
    report("Checking the local proof server and compiled contract assets...");
    await dependencies.preflight();

    recoveryPhrase = await dependencies.readRecoveryPhrase();
    report("Opening the local Preprod wallet and waiting for synchronization...");
    session = await dependencies.openWallet(recoveryPhrase);
    recoveryPhrase = "";

    const deployment = await dependencies.deployPolicy(session, report);
    await dependencies.persistReceipt(deployment);
    report("Verified public deployment receipt saved.");
    return deployment;
  } finally {
    recoveryPhrase = "";
    if (session) await session.close().catch(() => {});
  }
}

export async function readHiddenRecoveryPhrase(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new LocalDeploymentCommandError(
      "Run this command in an interactive terminal; redirected recovery phrases are refused.",
    );
  }

  output.write("Lace recovery phrase (hidden): ");
  input.setRawMode(true);

  return await new Promise<string>((resolve, reject) => {
    const characters: string[] = [];

    const finish = (error?: Error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      const phrase = characters.join("").trim().replace(/\s+/g, " ");
      characters.fill("");
      if (error) reject(error);
      else resolve(phrase);
    };

    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish(new LocalDeploymentCommandError("Deployment cancelled before wallet access."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          characters.pop();
          continue;
        }
        if (character >= " ") characters.push(character);
      }
    };

    input.on("data", onData);
    input.resume();
  });
}
