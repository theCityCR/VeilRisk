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
