import {
  CostModel,
  QueryContext,
  createConstructorContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  ledger,
} from "../managed/veilrisk/contract/index.js";

const DEFAULT_LIMITS = {
  speculative: 2_000n,
  growth: 7_000n,
  singleBucket: 6_000n,
};

export class VeilRiskSimulator {
  constructor(limits = DEFAULT_LIMITS) {
    this.contract = new Contract({});

    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      createConstructorContext({}, "0".repeat(64)),
      limits.speculative,
      limits.growth,
      limits.singleBucket,
    );

    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  getLedger() {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  prove({ cash, bonds, equities, speculative }) {
    this.circuitContext = this.contract.impureCircuits.proveCompliance(
      this.circuitContext,
      cash,
      bonds,
      equities,
      speculative,
    ).context;

    return this.getLedger();
  }
}
