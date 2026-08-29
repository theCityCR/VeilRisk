export const defaultPolicy = Object.freeze({
  maxSpeculative: 2_000,
  maxGrowth: 7_000,
  maxSingleBucket: 6_000,
});

const unrestrictedPolicy = Object.freeze({
  maxSpeculative: 10_000,
  maxGrowth: 10_000,
  maxSingleBucket: 10_000,
});

const concentrationPolicy = Object.freeze({
  maxSpeculative: 10_000,
  maxGrowth: 10_000,
  maxSingleBucket: 6_000,
});

export const policyVectors = [
  {
    name: "balanced portfolio",
    allocation: { cash: 1_500, bonds: 2_500, equities: 5_000, speculative: 1_000 },
    policy: defaultPolicy,
    passed: true,
  },
  {
    name: "speculative and growth caps one basis point below",
    allocation: { cash: 1_001, bonds: 2_000, equities: 5_000, speculative: 1_999 },
    policy: defaultPolicy,
    passed: true,
  },
  {
    name: "speculative and growth caps exactly",
    allocation: { cash: 1_000, bonds: 2_000, equities: 5_000, speculative: 2_000 },
    policy: defaultPolicy,
    passed: true,
  },
  ...[
    ["cash", { cash: 5_999, bonds: 2_001, equities: 2_000, speculative: 0 }],
    ["bonds", { cash: 2_001, bonds: 5_999, equities: 2_000, speculative: 0 }],
    ["equities", { cash: 2_001, bonds: 2_000, equities: 5_999, speculative: 0 }],
    ["speculative", { cash: 4_001, bonds: 0, equities: 0, speculative: 5_999 }],
  ].map(([bucket, allocation]) => ({
    name: `${bucket} concentration cap one basis point below`,
    allocation,
    policy: bucket === "speculative" ? concentrationPolicy : defaultPolicy,
    passed: true,
  })),
  ...[
    ["cash", { cash: 6_000, bonds: 2_000, equities: 2_000, speculative: 0 }],
    ["bonds", { cash: 2_000, bonds: 6_000, equities: 2_000, speculative: 0 }],
    ["equities", { cash: 2_000, bonds: 2_000, equities: 6_000, speculative: 0 }],
    ["speculative", { cash: 2_000, bonds: 2_000, equities: 0, speculative: 6_000 }],
  ].map(([bucket, allocation]) => ({
    name: `${bucket} concentration cap exactly`,
    allocation,
    policy: bucket === "speculative" ? concentrationPolicy : defaultPolicy,
    passed: true,
  })),
  {
    name: "zero and 10,000 basis-point allocation limits",
    allocation: { cash: 10_000, bonds: 0, equities: 0, speculative: 0 },
    policy: unrestrictedPolicy,
    passed: true,
  },
  {
    name: "total one basis point below 10,000",
    allocation: { cash: 1_499, bonds: 2_500, equities: 5_000, speculative: 1_000 },
    policy: defaultPolicy,
    passed: false,
    failureId: "total",
    compactFailure: "Portfolio allocations must sum to 100 percent",
  },
  {
    name: "total one basis point above 10,000",
    allocation: { cash: 1_501, bonds: 2_500, equities: 5_000, speculative: 1_000 },
    policy: defaultPolicy,
    passed: false,
    failureId: "total",
    compactFailure: "Portfolio allocations must sum to 100 percent",
  },
  {
    name: "speculative cap one basis point above",
    allocation: { cash: 2_000, bonds: 1_999, equities: 4_000, speculative: 2_001 },
    policy: defaultPolicy,
    passed: false,
    failureId: "speculative",
    compactFailure: "Speculative exposure exceeds policy",
  },
  {
    name: "growth cap one basis point above",
    allocation: { cash: 1_499, bonds: 1_500, equities: 6_000, speculative: 1_001 },
    policy: defaultPolicy,
    passed: false,
    failureId: "growth",
    compactFailure: "Combined growth exposure exceeds policy",
  },
  ...[
    ["cash", { cash: 6_001, bonds: 3_999, equities: 0, speculative: 0 }, "Cash concentration exceeds policy"],
    ["bonds", { cash: 3_999, bonds: 6_001, equities: 0, speculative: 0 }, "Bond concentration exceeds policy"],
    ["equities", { cash: 3_999, bonds: 0, equities: 6_001, speculative: 0 }, "Equity concentration exceeds policy"],
    ["speculative", { cash: 3_999, bonds: 0, equities: 0, speculative: 6_001 }, "Speculative concentration exceeds policy"],
  ].map(([bucket, allocation, compactFailure]) => ({
    name: `${bucket} concentration cap one basis point above`,
    allocation,
    policy: concentrationPolicy,
    passed: false,
    failureId: "concentration",
    compactFailure,
  })),
];
