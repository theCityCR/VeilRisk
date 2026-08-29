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
boundary vectors in tests. Wiring the generated bindings and Lace wallet is the
next integration milestone.

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

Midnight's proof server and a Lace wallet configured for Preprod are required
for the final browser-to-chain integration.

## Focused roadmap

- Generate TypeScript bindings from the Compact contract.
- Expand the deterministic browser E2E suite to cover all required journeys.
- Connect Lace and deploy/join the risk-policy contract on Preprod.
- Replace the local proof animation with the real transaction lifecycle.
- Send only approved policy outcomes to the AI explanation endpoint.
- Record the required two-minute public demo.

## Project structure

```text
app/                 Browser experience
lib/risk.ts          Deterministic policy engine
lib/verification.ts  Injectable external-service workflow
contract/src/        Compact smart contract
.openai/hosting.json Optional frontend hosting configuration
```

The verification workflow accepts injected wallet, proof-provider,
transaction, indexer, and AI ports. Routine tests use deterministic fakes; real
Preprod dependencies remain a separate integration milestone.

This repository is intentionally scoped to a demonstrable privacy boundary. It
does not execute trades, connect to brokerages, or provide financial advice.
