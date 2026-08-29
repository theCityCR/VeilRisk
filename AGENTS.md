# VeilRisk agent requirements

These instructions apply to every change in this repository. VeilRisk is
expected to be developed largely by coding agents with limited human review, so
tests and explicit evidence are part of the implementation, not optional
follow-up work.

## Non-negotiable product invariants

- Portfolio allocations, presets, wallet secrets, witness data, and private
  state must never appear in public state, transaction metadata, logs,
  analytics, error reports, URLs, storage, or external requests.
- Invalid portfolios must fail locally. They must not create an attestation,
  request a wallet signature, or submit a transaction.
- Compliance is calculated only by deterministic TypeScript code and the
  Compact circuit. The privacy summary is derived deterministically from local
  evaluation or finalized verification state.
- A local or simulated result must be labelled as such. Do not display a fake
  transaction identifier, finalized state, or network verification.
- The rules in `lib/risk.ts` and `contract/src/veilrisk.compact` must remain
  behaviorally identical. Any rule change must update and test both layers.
- Do not claim production security, an audit, or real zero-knowledge
  verification until the corresponding implementation and evidence exist.

## Required development workflow

1. Read `README.md` and the relevant sections of `docs/PROJECT_SPEC.md` before
   changing behavior.
2. Inspect the current implementation and tests. Preserve unrelated user
   changes and keep the patch narrowly scoped.
3. Define observable success, failure, boundary, recovery, and privacy cases
   before implementation.
4. Add or update tests in the same change as the behavior. A bug fix requires a
   regression test that fails without the fix.
5. Run every relevant quality gate after the final edit. Never describe work as
   complete if a required check failed or was not run; report the exact gap.
6. Review the final diff for leaked private data, generated artifacts, accidental
   dependency changes, misleading product copy, and unrelated edits.
7. Update documentation and the current-status section when implementation
   claims or setup steps change.
8. Commit every completed repository change before handing work back. Use
   focused commits that each contain one coherent concern, include its tests and
   documentation, and do not mix unrelated pre-existing user changes. Do not
   amend or rewrite existing commits unless the user explicitly requests it.

## Test policy

Every externally observable behavior must be covered at the cheapest reliable
layer, and every critical user workflow must also have an end-to-end test.
Passing E2E tests do not replace focused unit, contract, integration, privacy,
or accessibility tests.

For every feature, cover as applicable:

- the normal successful path;
- invalid input and each distinct failure path;
- exact limits plus one unit below and above each boundary;
- stale-state invalidation after edits;
- rejection, timeout, retry, disconnection, and recovery states;
- persistence and fresh-session behavior;
- keyboard and mobile behavior;
- absence of unexpected console errors and unhandled requests; and
- privacy: prohibited values must be proven absent from public UI, URLs,
  storage, logs, requests, and transaction data.

Additional rules:

- Prefer deterministic tests. Freeze time and identifiers where relevant.
- Mock wallets, proof providers, indexers, and network failures for routine CI.
  Keep real Preprod tests in a separate, clearly labelled smoke suite so
  external instability does not weaken deterministic coverage.
- Do not use fixed delays when a visible state or event can be awaited.
- Do not rely on snapshots alone for correctness or privacy assertions.
- Do not disable, skip, loosen, or delete a test merely to make a change pass.
  If behavior intentionally changes, update the requirement and explain why.
- Tests must assert user-visible outcomes and forbidden side effects, not only
  implementation details.
- Generated Compact output under `contract/src/managed/` remains ignored. Tests
  compile it from source before executing the simulator.

## Mandatory E2E coverage

The browser E2E suite must cover every user action and at least these journeys:

1. The balanced preset produces a passing local preview.
2. The risky preset fails locally and creates no attestation or outbound
   submission.
3. Totals other than 10,000 basis points cannot be submitted.
4. Editing an allocation or policy clears a stale result.
5. Values at every cap pass and values one basis point above fail.
6. Wallet unavailable, disconnected, and signature-rejected states recover.
7. A valid proof progresses through generation, signature, submission, and
   finalization.
8. Proof-provider and transaction failures produce accurate, recoverable UI.
9. The public attestation never exposes private allocations.
10. The privacy-safe summary is deterministic, contains no private allocation,
    and makes no external explanation request.
11. Refreshing or opening a fresh browser session does not restore stale private
    or verified state.
12. The complete demo works with keyboard controls and at a mobile viewport.

When a journey depends on an unimplemented feature, keep it documented as a
required pending test. Add the deterministic mocked E2E test in the same change
that implements the feature.

## Quality gates

The minimum local gate is:

```bash
npm install
cd contract && npm install && cd ..
npm test
npm run lint
```

Once the browser E2E harness exists, its command must be included in `npm test`
or in a single documented `npm run check` command used by CI. Before handing off
a meaningful change, also verify:

- a clean production build;
- Compact compilation and all simulator tests;
- all browser E2E tests at desktop and mobile viewports;
- no unexpected browser console errors;
- no raw allocation values in captured public or outbound artifacts; and
- `git diff --check` plus a focused review of the changed files.

If a check cannot run because a service, wallet, toolchain, or credential is
unavailable, do not silently substitute a weaker claim. Run all independent
checks, document the blocker, and leave the affected requirement incomplete.

## Dependency and change discipline

- Prefer small, well-maintained dependencies and use lockfiles. Explain any new
  runtime dependency that affects privacy, cryptography, wallet behavior, or
  the production bundle.
- Never edit generated bindings to fix source behavior; change the Compact
  source and regenerate them.
- Avoid broad refactors during feature or bug work unless required for
  correctness. Preserve public behavior not explicitly in scope.
- Keep external side effects behind adapters so tests can prove both expected
  calls and forbidden calls.
- Treat type errors, lint errors, warnings that indicate correctness problems,
  flaky tests, and unexpected console output as failures to resolve rather than
  noise to suppress.
