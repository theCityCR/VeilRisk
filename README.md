# VeilRisk

**Prove the policy. Keep the portfolio.**

VeilRisk is a privacy-preserving portfolio-compliance DApp for the Midnight
Hackathon: August 2026. A user can prove that a private allocation satisfies a
public risk mandate without putting the underlying holdings on a public ledger.

## Hackathon demo

1. Select the risky portfolio preset.
2. Generate an attestation and show which public policy conditions fail.
3. Switch to the balanced preset.
4. Generate a passing attestation.
5. Emphasize that the public result reveals the policy and outcome—not the raw
   allocation.

The browser experience provides a private local preview and a real Midnight
verification action. Invalid portfolios stop locally and never reach Lace.
Valid portfolios using the deployed policy progress through proof generation,
Lace approval, submission, and Preprod indexer finalization. The public panel
receives only the policy name, network, contract address, successful transaction
identifier, and compliance outcome. `contract/src/veilrisk.compact` contains the
matching Compact circuit, and both engines run the same shared basis-point
boundary vectors in tests.

## Privacy boundary

| Data | Visibility |
| --- | --- |
| Portfolio allocations | Private circuit inputs |
| Risk limits | Public contract state |
| Pass/fail transaction | Public and verifiable |
| AI disclosure packet | Policy outcomes only |

The AI layer must never calculate the compliance result. It receives a
deterministic, selectively disclosed summary after the policy engine evaluates
the portfolio.

## Run the browser app

```bash
npm install
npm run dev
```

The development and production build commands compile the Compact contract and
copy its generated proving/verifying assets into an ignored public build path.

## Build and validate

```bash
npm --prefix contract install
npm run build
npm test
npm run lint
```

Agent-authored changes must follow the repository-wide correctness, privacy,
test-coverage, and completion rules in [`AGENTS.md`](AGENTS.md). Every observable
behavior requires appropriate automated coverage, and every critical user
journey requires deterministic browser E2E coverage.

## Compile the Midnight contract

Prerequisites:

- Node.js 24.11.1 or newer
- Docker Desktop with Compose v2
- Compact developer tools with toolchain 0.31.1

```bash
cd contract
npm install
npm run compact
npm test
```

A Lace wallet configured for Preprod is required for browser setup. Lace
delegates proving to the provider selected in the wallet; real proof generation
and submission still require reachable Preprod services and a deployed VeilRisk
contract. VeilRisk requests each wallet capability only when its corresponding
step begins; it does not make an eager permission-hint request during setup.

## Deploy the policy contract on Preprod

The reliable operator path is a local, headless wallet command. Before running
it, make sure the local proof server is ready at `http://127.0.0.1:6300` and the
Lace account has finished synchronizing and is generating tDUST. Then run:

```bash
npm run deploy:preprod
```

The command compiles the contract, checks the proof server before requesting a
secret, and asks for the Lace recovery phrase through a hidden terminal prompt.
It deliberately accepts no arguments and refuses redirected input, so do not
put the phrase in an environment variable, command-line argument, project file,
or chat. It derives the same account locally in process memory, waits until
Preprod synchronization completes, confirms that tDUST is available, and
deploys the fixed Conservative mandate (20% speculative, 70% growth, and 60%
concentration). The first headless synchronization can take several minutes and
prints privacy-safe progress messages while it runs. An interrupted RPC/indexer
synchronization is retried up to three times with fresh in-memory wallet state;
empty tDUST and the known intermittent Preprod tDUST synchronization fault
remain explicit and create no transaction.

After a successful synchronization, the command saves an encrypted, owner-only
retry cache at `work/private/preprod-wallet-state.enc.json`. Its encryption key
is derived locally from the recovery phrase, which is never saved. The entire
`work/` directory is ignored by Git. The first run after installing this version
still needs a cold synchronization; later retries restore the cache and only
sync changes since it was written. Deleting the cache is safe and simply forces
another cold synchronization.

Contract preparation also copies the generated JavaScript binding into the
root ignored `work/` runtime. This ensures the binding and deployment SDK share
one Midnight protocol instance; loading the binding from the contract package's
nested dependencies makes otherwise valid deployment values fail runtime type
checks before proof generation.

After finalization, the command reads the indexed ledger state and confirms the
three policy limits and an initial proof count of zero. Only then does it update
`config/preprod-deployment.json`. Its terminal output and saved receipt contain
only the public contract address, transaction ID, network, and policy. No
portfolio allocation participates in policy deployment.

The fixed policy contract is deployed and independently verified on Preprod.
The public identifiers and inspection evidence are recorded in
[`docs/PREPROD_DEPLOYMENT.md`](docs/PREPROD_DEPLOYMENT.md).

The browser operator page remains available at `http://localhost:3000/deploy`
for Lace connector testing. It performs the same public-state verification, but
the local command does not depend on the browser extension connection.

Neither deployment path logs or serializes the SDK deployment object because
that object also contains private wallet and maintenance data. Never add wallet
keys, addresses, witness data, recovery phrases, or SDK diagnostic objects to
the tracked public record.

The deployment-only contract maintenance key is held in memory until the local
wallet session closes and is then discarded. VeilRisk currently has no contract
maintenance workflow; the deployed policy is intended to remain fixed.

## Focused roadmap

- Send only approved policy outcomes to the AI explanation endpoint.
- Record the required two-minute public demo.

## Project structure

```text
app/                 Browser experience
lib/risk.ts          Deterministic policy engine
lib/verification.ts  Injectable workflow and generated Midnight binding adapter
contract/src/        Compact smart contract
scripts/             Generated-asset preparation and local Preprod deployment
.openai/hosting.json Optional frontend hosting configuration
```

The verification layer accepts deterministic fakes for routine tests and owns
the Midnight.js contract preparation, proof, balance/approval, submission, and
finalization details. The pinned Midnight runtime dependencies match Compact
toolchain 0.31.1. Lace discovery, Preprod validation, wallet-delegated providers,
the verified deployed contract, and the browser transaction lifecycle are
implemented. The first real browser compliance call has finalized successfully
and its indexed public transaction and ledger state are recorded in
[`docs/PREPROD_DEPLOYMENT.md`](docs/PREPROD_DEPLOYMENT.md).

This repository is intentionally scoped to a demonstrable privacy boundary. It
does not execute trades, connect to brokerages, or provide financial advice.
