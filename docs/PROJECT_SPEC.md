# VeilRisk Project Specification

## 1. Purpose

VeilRisk is a privacy-preserving portfolio-compliance application built for the
Midnight Hackathon: August 2026.

The application lets a person prove that a private portfolio allocation follows
a public risk policy without revealing the allocation itself. It demonstrates a
useful boundary between private financial information, deterministic compliance
logic, public verification, and an AI-generated explanation.

The project should be credible as both:

- a focused hackathon submission with a polished two-minute demonstration; and
- a resume project showing privacy engineering, zero-knowledge proofs,
  TypeScript, smart-contract integration, testing, and careful AI system design.

VeilRisk is not a trading system, portfolio optimizer, brokerage integration, or
source of financial advice.

## 2. Core user story

> As a portfolio owner, I want to prove that my allocation satisfies a known
> risk mandate without disclosing my holdings or allocation weights.

A successful demonstration should show this sequence:

1. The user selects or enters a private allocation.
2. The application evaluates it against a public risk policy.
3. A risky allocation fails locally and identifies only the violated rules.
4. The user changes to a compliant allocation.
5. The browser generates and submits a Midnight zero-knowledge proof.
6. A public verification view shows a valid attestation without showing the
   private inputs.
7. An AI explanation receives only an approved disclosure packet and explains
   the outcome in plain language.

The memorable product moment is the contrast between the **Private Portfolio**
view and the **Public Attestation** view.

## 3. Success criteria

The hackathon MVP is complete when:

- the browser connects to a Midnight-compatible Lace wallet;
- the Compact contract compiles and has automated contract tests;
- a policy contract can be deployed or joined on the selected network;
- a valid private allocation produces a real finalized Midnight transaction;
- raw allocation values never appear in public contract state, transaction
  metadata, logs, analytics, or an AI request;
- an invalid allocation fails before submission and creates no public failure
  record;
- the UI clearly distinguishes local evaluation from on-chain verification;
- the project builds from a fresh checkout using documented instructions;
- the public repository contains a concise README and architecture explanation;
- a two-minute video demonstrates the real proof flow without relying on edits
  or claims that cannot be reproduced.

Winning a prize is not a completion requirement.

## 4. Scope

### MVP

The portfolio contains four allocation buckets represented as integer basis
points:

- cash;
- bonds;
- equities; and
- speculative assets.

The public policy contains three limits:

- allocations must sum to 10,000 basis points;
- speculative exposure must not exceed its configured cap;
- equities plus speculative exposure must not exceed the growth cap; and
- no single bucket may exceed the concentration cap.

The MVP needs only two presets plus editable inputs:

- a deliberately noncompliant portfolio; and
- a compliant portfolio.

### Stretch goals

Implement these only after the complete proof flow works:

- a blinded portfolio commitment attached to an attestation;
- multiple named risk policies;
- an expiring attestation or portfolio-version nonce;
- a shareable verification route;
- a downloadable verification receipt;
- more expressive asset classes or weighted risk scores; and
- a polished AI reallocation explanation based on explicitly disclosed
  category-level information.

### Explicit non-goals

- Live prices or market-data feeds
- Brokerage or exchange connectivity
- Executing or recommending trades
- Predicting returns
- User accounts or persistent portfolio storage
- A token, marketplace, or cross-chain protocol
- Hiding whether a successful attestation exists
- Claiming production security or audited cryptography

## 5. Privacy and disclosure model

| Information | Intended visibility |
| --- | --- |
| Allocation values | Private; remain in the browser/private witness state |
| Portfolio presets selected by the user | Private |
| Risk-policy limits | Public contract state |
| Contract address and successful transaction | Public |
| Exact reason an attempted proof failed | Local only |
| Successful compliance result | Public and verifiable |
| AI disclosure packet | Only the minimum fields approved by the user |
| AI-generated explanation | Visible to the user; public only if shared |

Important rules:

1. Compliance must be calculated by deterministic code and the Compact
   circuit—not by an AI model.
2. An invalid allocation should fail locally and should not publish a failure
   transaction. Publishing failures would leak information about the user's
   private state.
3. Logs must never include raw allocations, wallet secrets, private-state
   material, or full AI prompts containing sensitive values.
4. The interface must not label a simulated delay or local calculation as a
   zero-knowledge proof after real Midnight integration begins.
5. The README and demo must distinguish implemented guarantees from planned
   guarantees.

## 6. Architecture

```text
Private browser state
  allocation in basis points
          │
          ├──> deterministic local policy check
          │       └──> local failure details (never submitted)
          │
          └──> Midnight private circuit inputs
                  └──> Compact assertions
                          └──> finalized public success transaction
                                  ├──> public verification UI
                                  └──> minimal disclosure packet
                                          └──> AI explanation
```

### Components

#### Browser application

Responsibilities:

- collect private allocation values;
- validate input ranges and the 100% total;
- display the public policy;
- connect to Lace;
- display proof-generation and transaction status;
- show a public-safe attestation; and
- construct the minimum AI disclosure packet.

#### Deterministic policy module

`lib/risk.ts` is the browser-side reference implementation of the policy. Its
rules must remain synchronized with the Compact contract. It improves feedback
speed but is not the source of public verification.

#### Compact contract

`contract/src/veilrisk.compact` receives allocation values as private circuit
inputs. It exposes policy limits as public state and permits a successful
transaction only if every policy assertion passes.

The contract compiles, its generated simulator passes shared boundary tests,
and the fixed policy is deployed on Preprod. The browser call path is connected;
the first real portfolio-compliance transaction remains pending external smoke
verification.

#### Midnight integration adapter

This layer should own:

- generated contract bindings;
- wallet connection;
- proof-provider configuration;
- contract deployment and joining;
- transaction submission; and
- finalized transaction details.

UI components should not contain Midnight SDK plumbing directly.

#### AI explanation adapter

The AI request should use a strict structured input such as:

```ts
type DisclosurePacket = {
  policyName: string;
  compliant: boolean;
  disclosedViolations: string[];
  userApprovedDetailLevel: "result-only" | "category-guidance";
};
```

Raw allocation numbers must be excluded by construction. The response should
explain the verified result and limitations, not provide personalized financial
advice.

## 7. Functional requirements

### Portfolio input

- **FR-1:** Accept four allocations from 0 to 10,000 basis points.
- **FR-2:** Show their current total and reject totals other than 10,000.
- **FR-3:** Provide deterministic compliant and noncompliant demo presets.
- **FR-4:** Clear any stale attestation when an allocation or policy changes.

### Policy verification

- **FR-5:** Display the public limits before the user generates a proof.
- **FR-6:** Run the matching local checks for immediate feedback.
- **FR-7:** Prevent an invalid allocation from being submitted to Midnight.
- **FR-8:** Submit valid allocations as private Compact circuit inputs.
- **FR-9:** Display transaction progress and the finalized transaction ID.

### Public attestation

- **FR-10:** Show the policy, network, contract address, and successful result.
- **FR-11:** Never show the private allocation in the public view.
- **FR-12:** Clearly identify simulated/local results until a real transaction
  has finalized.

### AI explanation

- **FR-13:** Construct the AI input from approved policy outcomes only.
- **FR-14:** Validate model output before rendering it.
- **FR-15:** Fall back to a deterministic explanation if the AI call fails.

## 8. Build order

### Phase 1: Prove the contract

1. Install Docker Desktop and Compact developer tools.
2. Pin the toolchain version required by the current Midnight SDK.
3. Compile `veilrisk.compact` and correct any language errors.
4. Add simulator tests for boundary values and every failed assertion.
5. Confirm generated artifacts are ignored or committed according to Midnight's
   recommended template.

Do not work on AI integration before this phase succeeds.

### Phase 2: Connect Midnight

1. Adapt the official Midnight browser example rather than rebuilding wallet
   providers from memory.
2. Connect Lace on Preview or Preprod.
3. Deploy a policy contract.
4. Submit a compliant allocation.
5. Surface the finalized transaction in the UI.
6. Verify through the indexer that no private allocation values are public.

### Phase 3: Correct the product states

Replace the current local proof animation with explicit states:

- editing;
- invalid locally;
- wallet connection required;
- generating proof;
- awaiting signature;
- submitted;
- finalized; and
- failed.

The public panel must show **local preview** until finalization.

### Phase 4: Add the AI explanation

1. Define and test `DisclosurePacket` serialization.
2. Add a server-side AI endpoint with a strict response schema.
3. Confirm raw allocations cannot reach the endpoint.
4. Add a deterministic fallback explanation.
5. Include a clear non-advice disclaimer.

### Phase 5: Submission polish

1. Test the complete flow from a fresh browser session.
2. Improve mobile layout and keyboard accessibility.
3. Add an architecture diagram or annotated privacy-boundary screenshot.
4. Reduce setup instructions to one reliable path.
5. Prepare the Devpost description.
6. Record a two-minute demo created during the event.

## 9. Verification plan

### Policy tests

- Exactly 10,000 basis points passes the total check.
- Totals of 9,999 and 10,001 fail.
- Values exactly at each public cap pass.
- Values one basis point above each cap fail.
- Every individual bucket is checked against the concentration cap.
- Large valid inputs do not overflow the selected Compact integer type.

### Privacy checks

- Inspect the generated transaction and public ledger state.
- Search application logs for allocation values and private-state material.
- Confirm failed local evaluations create no transaction.
- Inspect the AI request body and confirm it contains no raw allocation.
- Confirm browser analytics and error reporting are disabled or sanitized.

### Product checks

- The risky preset visibly fails locally.
- The balanced preset can produce a finalized proof.
- Editing any input invalidates the displayed attestation.
- Wallet rejection returns the user to a recoverable state.
- The project builds and its tests pass from a clean checkout.
- The complete demo can be performed in under two minutes.

### AI-assisted development requirements

This project assumes that coding agents may implement changes with little human
supervision. `AGENTS.md` is the authoritative execution policy for agents. At a
minimum:

- every externally observable behavior must have success, failure, boundary,
  recovery, and privacy coverage at the appropriate test layer;
- every critical user journey must have a deterministic browser E2E test;
- contract rules must be tested in both the TypeScript policy engine and the
  generated Compact simulator, using matching boundary vectors;
- every bug fix must include a regression test;
- wallet, proof-provider, indexer, transaction, and AI dependencies must be
  mockable so routine CI is deterministic;
- a separate real-Preprod smoke suite must verify the external integration
  without making routine correctness depend on network availability;
- tests must assert forbidden side effects, including the absence of wallet or
  network calls after local validation failure and the absence of private data
  from public or outbound artifacts;
- agents must not weaken or skip tests to make a patch pass; and
- agents must state which required checks ran and must not claim completion when
  a relevant gate is failing or unavailable.

The browser E2E suite must eventually exercise every available user action and
must include preset selection, editable inputs, all policy boundaries,
stale-attestation clearing, wallet rejection and recovery, proof and transaction
state transitions, public-view privacy, AI disclosure filtering and fallback,
fresh-session behavior, keyboard access, and mobile layout. A feature is not
complete until its corresponding deterministic E2E coverage lands with it.

## 10. Current status

Implemented:

- responsive private/public browser experience;
- compliant and risky demo presets;
- deterministic local policy evaluation;
- integer basis-point inputs with shared parity vectors executed by both the
  TypeScript policy engine and generated Compact simulator;
- explicit local-preview states that prevent invalid portfolios from producing
  an attestation and do not claim network verification;
- deterministic browser E2E coverage at desktop and mobile viewports for
  presets, invalid totals, policy boundaries, stale-state invalidation,
  keyboard use, fresh sessions, public-surface privacy, outbound submission
  absence, viewport overflow, unexpected browser errors, Lace absence,
  authorization rejection, disconnection, retry, and recovery;
- injectable wallet, proof-provider, transaction, indexer, and AI ports with a
  deterministic orchestration suite covering local short-circuiting, lifecycle
  order, dependency failures, retry recovery, and disclosure filtering;
- a browser-ready Midnight.js 4.1.1 adapter that wraps the generated Compact
  binding, serves generated ZK assets from an ignored build path, submits the
  typed `proveCompliance` private inputs, and returns only public transaction
  identifiers;
- Lace connector API 4 discovery and Preprod validation with wallet-delegated
  proving, transaction balancing/submission, and indexer providers kept behind
  the verification adapter; setup exposes no wallet address, key material,
  allocations, proof, signature request, or transaction;
- a dedicated Lace-backed Preprod deployment surface that deploys the fixed
  public policy, returns only public identifiers, verifies the indexed ledger
  limits, and preserves a public receipt for recovery if indexer verification
  fails;
- a local Preprod deployment command using the compatible Midnight wallet SDK,
  a hidden interactive recovery-phrase prompt, local proof server, tDUST
  readiness check, safe retry for interrupted RPC/indexer synchronization,
  an encrypted Git-ignored wallet synchronization cache, a single shared
  Midnight runtime for generated bindings, ephemeral deployment maintenance
  state, indexed public-state verification, wallet cleanup, and an atomic
  public-only receipt write;
- a real Preprod deployment of the fixed Conservative mandate, with its
  public-only address and transaction identifier recorded after independent
  indexer verification;
- a browser verification action connected to that deployed contract, with
  explicit proof, Lace approval, submission, finalization, retry, and stale-state
  handling;
- deterministic desktop and mobile E2E coverage for the successful lifecycle,
  local short-circuiting, deployed-policy mismatch, each external failure, and
  public-panel privacy;
- public-safe explanation copy;
- verified Compact contract compilation and simulator tests for policy
  boundaries and assertion failures;
- frontend build, render test, and lint configuration; and
- project README and local hosting configuration.

Not yet implemented or verified:

- one finalized real compliance proof through Lace's configured proving
  provider, followed by public transaction and ledger inspection;
- AI API integration; and
- Devpost submission materials.

## 11. Resume-quality outcome

The project should be considered resume-ready only after the real Midnight
integration is working and the claims are verified. A future bullet might be:

> Built a privacy-preserving portfolio-compliance DApp in TypeScript and
> Compact, generating zero-knowledge proofs that allocation constraints were
> satisfied without publishing private portfolio weights.

Do not use that wording until a real Compact proof has been compiled, executed,
and inspected. If only the interactive prototype is completed, describe it as a
prototype and do not claim implemented zero-knowledge verification.
