# Verified Preprod deployment

VeilRisk's fixed Conservative mandate was deployed to Midnight Preprod on
August 29, 2026. The local deployment command finalized the transaction, read
the indexed contract state, and wrote the public-only receipt only after the
ledger values matched the intended policy.

## Public receipt

- Contract address:
  `3e3ab54fd9383a11b457cc48b73e084db0aaf63ad3499c149cc1b43e1cf4e4f6`
- Deployment transaction identifier:
  `00278124492b9ef69f7f7377306f1b1690707d9292bb83e289dcf503d98c63a611`
- Network: `preprod`

The same values are stored in `config/preprod-deployment.json`.

## Independent indexer inspection

A separate read-only query to the Preprod indexer after deployment returned:

- transaction status: `SucceedEntirely`;
- block height: `2319945`;
- block timestamp: `2026-08-29 19:37:24 UTC`;
- indexer transaction ID:
  `0060bd07630a882cd9b6afa63a60efa769e4e5b610c5290bd9518445263d94b6b0`;
- transaction hash:
  `92ffbf419a967d77d19356aebd3acf7b80616350586ec1312b0b27efa21e52d6`;
- the saved deployment identifier was present in the transaction's public
  `identifiers` collection; and
- the decoded initial ledger contained speculative cap `2000`, growth cap
  `7000`, single-bucket cap `6000`, and `successfulProofs = 0`.

The submitted deployment path accepts only those three public policy limits.
It has no portfolio-allocation parameter, witness, compliance proof, analytics
payload, or transaction-metadata field. The indexer's decoded public response
contained standard transaction, block, fee, identifier, contract-action, and
unshielded transport fields; it contained no allocation field. The zero proof
counter independently confirms that deployment did not include a portfolio
compliance attestation.

The raw transaction object is intentionally not copied into this repository:
Midnight SDK transaction objects may include wallet-related transport data that
is irrelevant to the public policy receipt. Automated deployment tests instead
assert both that only the three policy arguments are supplied and that private
deployment data is absent from the returned and persisted receipt.

## Verified browser compliance proof

The first real browser compliance proof was finalized through Lace on August
29, 2026. A separate read-only query to the Preprod indexer returned:

- submitted transaction identifier:
  `00cdb054a10b8d370323e468acf23ca642fdd2ca1080d7ac56c830df571ae6aadf`;
- transaction status: `SucceedEntirely`;
- block height: `2320472`;
- block timestamp: `2026-08-29 20:30:06 UTC`;
- indexer transaction ID: `577609`;
- transaction hash:
  `c8f3f37ae179e9d1cb92d28e56cab11c50b1e80bc7ea0c1d8255737a14c492d2`;
- the submitted identifier was present in the transaction's public
  `identifiers` collection; and
- the decoded ledger contained speculative cap `2000`, growth cap `7000`,
  single-bucket cap `6000`, and `successfulProofs = 1`.

The indexed transaction response exposed only standard transaction, status,
identifier, block, segment-status, unshielded-transport, protocol, and fee
fields. A case-insensitive scan found no `allocation`, `portfolio`, `cash`,
`bonds`, `equities`, or `speculativeBps` field or label. The browser receipt
likewise displayed only the public policy name, network, contract address,
transaction identifier, compliance outcome, and `Holdings disclosed: None`.
The four private allocation values used by the browser were also absent as
decoded public transaction values. No raw SDK transaction object is stored in
the repository.
