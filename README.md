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

The current browser experience implements a clearly labelled local compliance
preview through a deterministic policy adapter. Invalid portfolios stop locally
and never create a shareable preview. `contract/src/veilrisk.compact` contains
the matching Compact circuit. Both engines run the same shared basis-point
boundary vectors in tests. A browser-ready adapter now wraps the generated
contract binding and finalized Midnight.js call while returning only public
transaction identifiers. The browser now discovers Lace's version 4 connector,
checks its Preprod configuration, and prepares wallet-delegated proving,
balancing, submission, and indexer providers without requesting a proof or
signature during setup.

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
contract.

## Focused roadmap

- Deploy/join the risk-policy contract on Preprod.
- Connect the prepared Lace providers to the browser verification action.
- Replace the local preview action with the real proof and transaction lifecycle.
- Expand browser E2E coverage with mocked proof and transaction journeys.
- Send only approved policy outcomes to the AI explanation endpoint.
- Record the required two-minute public demo.

## Project structure

```text
app/                 Browser experience
lib/risk.ts          Deterministic policy engine
lib/verification.ts  Injectable workflow and generated Midnight binding adapter
contract/src/        Compact smart contract
scripts/             Reproducible generated-asset preparation
.openai/hosting.json Optional frontend hosting configuration
```

The verification layer accepts deterministic fakes for routine tests and owns
the Midnight.js `CompiledContract` and `submitCallTx` details. The pinned
Midnight runtime dependencies match Compact toolchain 0.31.1. Lace discovery,
Preprod validation, and wallet-delegated provider creation are implemented;
contract deployment and real Preprod verification remain separate milestones.

This repository is intentionally scoped to a demonstrable privacy boundary. It
does not execute trades, connect to brokerages, or provide financial advice.
