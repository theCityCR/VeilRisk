import { fileURLToPath } from "node:url";
import path from "node:path";
import { createVeilRiskDeployment, DeploymentError } from "../lib/deployment.ts";
import {
  LocalDeploymentCommandError,
  readHiddenRecoveryPhrase,
  runLocalPreprodDeployment,
  writePublicDeploymentRecord,
} from "../lib/local-preprod-deployment.ts";
import {
  checkLocalDeploymentPrerequisites,
  HeadlessWalletError,
  openHeadlessPreprodWallet,
} from "../lib/headless-midnight-wallet.ts";
import { DEFAULT_POLICY } from "../lib/risk.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compiledAssetsPath = path.join(
  projectRoot,
  "contract",
  "src",
  "managed",
  "veilrisk",
);
const publicRecordPath = path.join(projectRoot, "config", "preprod-deployment.json");

function report(message: string) {
  process.stdout.write(`${message}\n`);
}

async function main() {
  if (process.argv.length > 2) {
    throw new LocalDeploymentCommandError(
      "This command accepts no arguments. Enter the recovery phrase only at its hidden prompt.",
    );
  }

  const deployment = await runLocalPreprodDeployment({
    preflight: () => checkLocalDeploymentPrerequisites(compiledAssetsPath),
    readRecoveryPhrase: () => readHiddenRecoveryPhrase(),
    openWallet: (recoveryPhrase) => openHeadlessPreprodWallet(
      recoveryPhrase,
      compiledAssetsPath,
    ),
    deployPolicy: async (session, update) => {
      const deploy = createVeilRiskDeployment({
        network: "preprod",
        compiledAssetsBaseUrl: compiledAssetsPath,
        connect: async () => session.providers,
      });
      return await deploy(DEFAULT_POLICY, (state) => {
        if (state.status === "awaiting-deployment") {
          update("Generating, balancing, and submitting the deployment. This may take several minutes...");
        } else if (state.status === "verifying-public-state") {
          update("Transaction finalized; verifying the indexed public policy...");
        }
      });
    },
    persistReceipt: (deployment) => writePublicDeploymentRecord(
      publicRecordPath,
      deployment,
    ),
    report,
  });

  report(`Contract address: ${deployment.contractAddress}`);
  report(`Transaction ID: ${deployment.transactionId}`);
  report("Policy: speculative 20%, growth 70%, single bucket 60%.");
  report("No portfolio allocation was used or published.");
}

main().catch((cause: unknown) => {
  if (cause instanceof DeploymentError && cause.receipt) {
    process.stderr.write(
      "The transaction finalized, but indexed public state could not be verified. No deployment record was saved.\n",
    );
    process.stderr.write(`Contract address: ${cause.receipt.contractAddress}\n`);
    process.stderr.write(`Transaction ID: ${cause.receipt.transactionId}\n`);
  } else if (cause instanceof DeploymentError) {
    process.stderr.write(
      "The deployment was not verified. Check the local proof server, Preprod connectivity, and tDUST balance, then retry.\n",
    );
  } else if (cause instanceof HeadlessWalletError || cause instanceof LocalDeploymentCommandError) {
    process.stderr.write(`${cause.message}\n`);
  } else {
    process.stderr.write("The deployment command failed safely. Nothing was recorded.\n");
  }
  process.exitCode = 1;
});
