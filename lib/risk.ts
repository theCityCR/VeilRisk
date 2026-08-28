export type Allocation = {
  cash: number;
  bonds: number;
  equities: number;
  speculative: number;
};

export type RiskPolicy = {
  maxSpeculative: number;
  maxGrowth: number;
  maxSingleBucket: number;
};

export type PolicyCheck = {
  id: string;
  label: string;
  passed: boolean;
  publicDetail: string;
  publicMessage: string;
};

export const DEFAULT_POLICY: RiskPolicy = {
  maxSpeculative: 20,
  maxGrowth: 70,
  maxSingleBucket: 60,
};

export function evaluatePortfolio(allocation: Allocation, policy: RiskPolicy) {
  const values = Object.values(allocation);
  const total = values.reduce((sum, value) => sum + value, 0);
  const growth = allocation.equities + allocation.speculative;
  const largestBucket = Math.max(...values);

  const checks: PolicyCheck[] = [
    {
      id: "total",
      label: "Allocation is complete",
      passed: total === 100,
      publicDetail: "Private weights sum to 100%",
      publicMessage: "The submitted weights do not sum to 100%.",
    },
    {
      id: "speculative",
      label: "Speculative exposure",
      passed: allocation.speculative <= policy.maxSpeculative,
      publicDetail: `At or below the public ${policy.maxSpeculative}% cap`,
      publicMessage: "Speculative exposure exceeds the selected policy.",
    },
    {
      id: "growth",
      label: "Combined growth exposure",
      passed: growth <= policy.maxGrowth,
      publicDetail: `At or below the public ${policy.maxGrowth}% cap`,
      publicMessage: "Combined growth exposure exceeds the selected policy.",
    },
    {
      id: "concentration",
      label: "Single-bucket concentration",
      passed: largestBucket <= policy.maxSingleBucket,
      publicDetail: `No private bucket exceeds ${policy.maxSingleBucket}%`,
      publicMessage: "At least one allocation bucket exceeds the concentration policy.",
    },
  ];

  return {
    total,
    checks,
    failures: checks.filter((check) => !check.passed),
    passed: checks.every((check) => check.passed),
  };
}
