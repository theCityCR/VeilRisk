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

export const BASIS_POINTS_TOTAL = 10_000;

export const DEFAULT_POLICY: RiskPolicy = {
  maxSpeculative: 2_000,
  maxGrowth: 7_000,
  maxSingleBucket: 6_000,
};

export function formatBasisPoints(value: number) {
  return `${(value / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%`;
}

export function evaluatePortfolio(allocation: Allocation, policy: RiskPolicy) {
  const values = Object.values(allocation);
  const policyValues = Object.values(policy);

  if (!policyValues.every((value) => Number.isInteger(value) && value >= 0 && value <= BASIS_POINTS_TOTAL)) {
    throw new RangeError("Risk policy limits must be integer basis points between 0 and 10,000.");
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const growth = allocation.equities + allocation.speculative;
  const largestBucket = Math.max(...values);
  const validValues = values.every(
    (value) => Number.isInteger(value) && value >= 0 && value <= BASIS_POINTS_TOTAL,
  );

  const checks: PolicyCheck[] = [
    {
      id: "range",
      label: "Allocation values are valid",
      passed: validValues,
      publicDetail: "Each private weight is an integer from 0% to 100%",
      publicMessage: "At least one allocation is outside the supported range.",
    },
    {
      id: "total",
      label: "Allocation is complete",
      passed: total === BASIS_POINTS_TOTAL,
      publicDetail: "Private weights sum to 100%",
      publicMessage: "The submitted weights do not sum to 100%.",
    },
    {
      id: "speculative",
      label: "Speculative exposure",
      passed: allocation.speculative <= policy.maxSpeculative,
      publicDetail: `At or below the public ${formatBasisPoints(policy.maxSpeculative)} cap`,
      publicMessage: "Speculative exposure exceeds the selected policy.",
    },
    {
      id: "growth",
      label: "Combined growth exposure",
      passed: growth <= policy.maxGrowth,
      publicDetail: `At or below the public ${formatBasisPoints(policy.maxGrowth)} cap`,
      publicMessage: "Combined growth exposure exceeds the selected policy.",
    },
    {
      id: "concentration",
      label: "Single-bucket concentration",
      passed: largestBucket <= policy.maxSingleBucket,
      publicDetail: `No private bucket exceeds ${formatBasisPoints(policy.maxSingleBucket)}`,
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
