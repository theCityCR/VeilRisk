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

## Test

The simulator suite compiles the contract, executes its generated bindings, and
checks every policy boundary and assertion without submitting transactions:

```bash
npm test
```

The browser uses integer basis points and a deterministic local adapter with the
same policy rules. TypeScript and the generated Compact simulator execute one
shared set of success, failure, exact-cap, and one-basis-point boundary vectors.
The generated Midnight binding and Lace wallet provider setup are implemented.
The repository-level `/deploy` operator page is the supported path for the
one-time Preprod deployment; the public receipt remains pending until that real
wallet-approved transaction finalizes.
