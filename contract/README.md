# VeilRisk Compact contract

`veilrisk.compact` defines the first privacy boundary for the hackathon MVP.
Portfolio allocations are private circuit inputs. The contract publishes the
risk-policy limits and increments a public counter only when every assertion
passes.

## Compile

Install Compact developer tools and toolchain `0.31.1`, then run:

```bash
npm run compact
```

The browser currently uses a deterministic local adapter with the same policy
rules. The next milestone is replacing that adapter with the generated Midnight
contract bindings and Lace wallet flow.
