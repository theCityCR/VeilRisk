# VeilRisk Devpost submission

This is the copy-ready submission draft for **Midnight Hackathon: August
2026**. Replace the bracketed URL fields and add the public demo-video URL
before submitting. The current event requirements and deadline are published on
the [official Devpost page](https://midnight-hackathon-august-2026.devpost.com/).

## Submission fields

### Project name

VeilRisk

### Tagline

Prove the policy. Keep the portfolio.

### One-line description

VeilRisk proves that a private portfolio follows a public risk mandate on
Midnight without publishing the underlying allocation.

### Project links

- Code: <https://github.com/theCityCR/VeilRisk>
- Demo video: `[PUBLIC VIDEO URL]`
- Live app: `[PUBLIC APP URL, IF AVAILABLE]`
- Verified Preprod evidence:
  <https://github.com/theCityCR/VeilRisk/blob/main/docs/PREPROD_DEPLOYMENT.md>

### Built with

TypeScript, React, Vinext, Midnight Compact, Midnight.js, Lace, Playwright,
Node.js, and Cloudflare tooling.

## Project story

### Inspiration

Portfolio compliance normally creates an uncomfortable tradeoff: disclose the
holdings so someone can check the rules, or keep the holdings private and ask
others to trust the result. Allocation weights can reveal strategy, risk
appetite, and concentrated positions even when asset names are omitted.

VeilRisk explores a better boundary. The risk mandate is public and
independently inspectable, while the portfolio remains private. Midnight makes
it possible to prove that the rules were satisfied without putting the inputs
on a public ledger.

### What it does

VeilRisk lets a portfolio owner test four private allocation buckets—cash,
bonds, equities, and speculative assets—against a public Conservative mandate.
The policy requires allocations to total 100%, caps speculative exposure at
20%, caps equities plus speculative exposure at 70%, and caps every individual
bucket at 60%.

A risky portfolio fails immediately in the browser and creates no attestation,
wallet-signature request, or transaction. A compliant portfolio can continue
through zero-knowledge proof generation, Lace approval, submission, and
finalization on Midnight Preprod.

The public result contains the policy name, network, contract address,
successful transaction identifier, and compliance outcome. It does not contain
the four allocation values. A deterministic local summary explains what was
verified and what remained private without sending portfolio data to an AI or
other explanation service.

### How we built it

The browser keeps allocation values in private, non-persistent React state. A
deterministic TypeScript policy engine provides immediate feedback and blocks
invalid portfolios before any external dependency can run.

The matching Compact contract receives the four allocation values as private
circuit inputs and enforces the same public limits. TypeScript and Compact run
the same shared boundary vectors so values exactly at each cap pass while
values one basis point above fail in both layers.

The Midnight integration is isolated behind an adapter. For a valid portfolio,
it prepares the generated Compact contract, uses Lace's delegated providers,
requests approval only when the proof is ready, submits the transaction, and
waits for indexed Preprod finalization. This separation also makes the full
lifecycle deterministic to test without depending on live services in routine
CI.

The fixed Conservative policy contract was deployed and independently read
back from the Preprod indexer. A real browser compliance proof was then
finalized through Lace. The indexed ledger reported one successful proof, and
the public transaction inspection found no portfolio or allocation field
labels.

### Challenges we ran into

The hardest part was preserving the privacy boundary across the entire product,
not only inside the circuit. An invalid portfolio must never reach wallet or
network code, and errors, logs, URLs, browser storage, receipts, and public UI
must not accidentally reveal private values.

Real Midnight integration also required careful lifecycle handling. Wallet
discovery, delegated proving, signature approval, submission, and indexer
finalization can each fail independently, so the UI needed accurate,
recoverable states without exposing private SDK diagnostics.

Finally, the browser adapter and generated Compact binding had to share one
compatible Midnight runtime. Loading them through separate dependency trees
produced runtime type mismatches even though the values were valid. Preparing
the ignored generated binding in the root runtime resolved that boundary.

### Accomplishments that we're proud of

- A real browser-generated compliance proof finalized through Lace on Midnight
  Preprod.
- Independent indexer evidence confirms the public policy, successful proof
  counter, and absence of allocation field labels.
- Invalid portfolios fail locally before attestation, wallet approval, or
  outbound submission.
- The browser and Compact engines share exact basis-point boundary vectors.
- The app distinguishes private local previews from finalized on-chain results
  and never invents a transaction identifier.
- The deterministic suite covers success, failure, retry, privacy, keyboard,
  fresh-session, desktop, and mobile behavior.

### What we learned

Privacy is a system property. A private circuit is not enough if inputs later
appear in telemetry, error messages, storage, transaction metadata, or product
copy. Designing the forbidden side effects first made the integration safer and
the tests more meaningful.

We also learned that a local check and an on-chain proof serve different jobs.
The local engine gives fast, specific feedback without publishing failure
information. The Compact circuit provides the publicly verifiable success
claim. The interface has to communicate that distinction clearly.

### What's next for VeilRisk

The current build is a focused hackathon demonstration, not an audited or
production financial product. The next product steps would be a blinded
portfolio-version commitment, expiring attestations, multiple named policies,
and downloadable public verification receipts. Each extension would preserve
the same rule: private holdings never become public application or transaction
data.

## Judging highlights

- **Technology:** Matching TypeScript and Compact policy engines, generated
  zero-knowledge proving assets, Lace wallet integration, and real Preprod
  finalization.
- **Originality:** Portfolio-policy compliance is proven without disclosing the
  portfolio or publishing failed attempts.
- **Execution:** A polished private/public split view with explicit local,
  proof, signature, submission, and finalization states.
- **Completion:** The fixed policy is deployed, a browser proof has finalized,
  and the result has been independently inspected through the indexer.
- **Documentation:** Fresh-checkout build instructions, architecture, privacy
  boundary, test policy, and public Preprod evidence are included in the
  repository.
- **Business value:** The same pattern could support private mandate checks for
  investment managers, treasury policies, and regulated financial workflows
  without exposing proprietary positions.

## Submission image

Use `docs/assets/veilrisk-private-public-preview.jpg` as the primary project
image after it has been captured from the real app in the explicitly labelled
**Private local preview · not on-chain** state.

Suggested caption:

> Private allocation and local policy details stay on the left; the shareable
> panel on the right reveals the compliance outcome while disclosing no
> holdings. This screenshot is a local preview, not a finalized transaction.

Suggested alt text:

> VeilRisk interface with private portfolio allocation controls beside a
> privacy-safe compliance panel labelled as a local preview and not on-chain.

## Final submission checklist

- [ ] Confirm every team member completed Devpost and MLH registration using
  the same email address.
- [ ] Confirm the team has no more than five members and the project is entered
  in only this hackathon.
- [ ] Keep the repository public after the event.
- [ ] Record and publish a demo no longer than two minutes during the hackathon
  weekend.
- [ ] Say “Midnight Hackathon: August 2026” at the beginning of the video.
- [ ] Add the public video URL above and keep the video public after the event.
- [ ] Add a public live-app URL if one is available; do not delay submission if
  Devpost does not require one.
- [ ] Upload the primary image and verify that its local-preview label is
  readable at Devpost thumbnail size.
- [ ] Submit before **August 30, 2026 at 11:45 a.m. EDT**.
- [ ] Re-open the submitted project page and verify the code, video, image, and
  description are publicly accessible.
