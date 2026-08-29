"use client";

import { useMemo, useRef, useState } from "react";
import deploymentRecord from "../config/preprod-deployment.json";
import type {
  LaceConnectionSummary,
  LaceConnectorPort,
  LaceFailureReason,
  MidnightBindingPort,
  VerificationResult,
  VerificationState,
} from "../lib/verification";
import {
  BASIS_POINTS_TOTAL,
  DEFAULT_POLICY,
  evaluatePortfolio,
  formatBasisPoints,
  type Allocation,
  type RiskPolicy,
} from "../lib/risk";

const balancedPortfolio: Allocation = {
  cash: 1_500,
  bonds: 2_500,
  equities: 5_000,
  speculative: 1_000,
};
const concentratedPortfolio: Allocation = {
  cash: 500,
  bonds: 500,
  equities: 5_500,
  speculative: 3_500,
};
const labels: Record<keyof Allocation, string> = {
  cash: "Cash",
  bonds: "Bonds",
  equities: "Equities",
  speculative: "Speculative",
};
const policyName = "Conservative mandate";

type WalletSetupState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "connected"; summary: LaceConnectionSummary }
  | { status: "failed"; reason: LaceFailureReason; message: string };

type OnChainUiState = VerificationState | { status: "idle" };

type E2EWindow = typeof globalThis & {
  __veilriskE2EMidnightController?: import("../lib/e2e-midnight-binding").E2EMidnightController;
};

function policyMatchesDeployment(policy: RiskPolicy) {
  return policy.maxSpeculative === deploymentRecord.policy.maxSpeculative
    && policy.maxGrowth === deploymentRecord.policy.maxGrowth
    && policy.maxSingleBucket === deploymentRecord.policy.maxSingleBucket;
}

function verificationLabel(state: OnChainUiState) {
  switch (state.status) {
    case "wallet-connection-required":
      return "Connecting to Lace…";
    case "generating-proof":
      return "Generating zero-knowledge proof…";
    case "awaiting-signature":
      return "Approve the transaction in Lace…";
    case "submitting":
      return "Submitting to Midnight Preprod…";
    case "submitted":
      return "Submitted · awaiting Preprod finalization…";
    case "failed":
      return "Retry on-chain verification";
    default:
      return "Verify privately on Preprod";
  }
}

export default function Home() {
  const [allocation, setAllocation] = useState<Allocation>(balancedPortfolio);
  const [policy, setPolicy] = useState<RiskPolicy>(DEFAULT_POLICY);
  const [hasLocalPreview, setHasLocalPreview] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [walletSetup, setWalletSetup] = useState<WalletSetupState>({ status: "idle" });
  const [onChainState, setOnChainState] = useState<OnChainUiState>({ status: "idle" });
  const [verifiedResult, setVerifiedResult] = useState<Extract<
    VerificationResult,
    { status: "finalized" }
  > | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [submittedTransactionId, setSubmittedTransactionId] = useState<string | null>(null);
  const walletConnector = useRef<LaceConnectorPort | null>(null);
  const evaluation = useMemo(
    () => evaluatePortfolio(allocation, policy),
    [allocation, policy],
  );
  const verificationBusy = [
    "wallet-connection-required",
    "generating-proof",
    "awaiting-signature",
    "submitting",
    "submitted",
  ].includes(onChainState.status);

  const clearResults = () => {
    setHasLocalPreview(false);
    setValidationAttempted(false);
    setOnChainState({ status: "idle" });
    setVerifiedResult(null);
    setVerificationMessage(null);
    setSubmittedTransactionId(null);
  };

  const updateAllocation = (key: keyof Allocation, value: number) => {
    setAllocation((current) => ({ ...current, [key]: value }));
    clearResults();
  };

  const createLocalPreview = () => {
    setHasLocalPreview(false);
    setValidationAttempted(true);
    setVerifiedResult(null);
    setOnChainState({ status: "idle" });
    setVerificationMessage(null);
    setSubmittedTransactionId(null);
    if (evaluation.passed) setHasLocalPreview(true);
  };

  const getWalletConnector = async () => {
    if (!walletConnector.current) {
      const { createBrowserLaceConnector } = await import("../lib/verification");
      walletConnector.current = createBrowserLaceConnector();
    }
    return walletConnector.current;
  };

  const walletFailure = async (cause: unknown) => {
    const { LaceConnectorError, getLaceFailureMessage } = await import("../lib/verification");
    const reason = cause instanceof LaceConnectorError ? cause.reason : "unknown";
    return { status: "failed" as const, reason, message: getLaceFailureMessage(reason) };
  };

  const connectWallet = async () => {
    setWalletSetup({ status: "connecting" });
    try {
      const summary = await (await getWalletConnector()).connect();
      setWalletSetup({ status: "connected", summary });
    } catch (cause) {
      setWalletSetup(await walletFailure(cause));
    }
  };

  const checkWallet = async () => {
    try {
      const summary = await (await getWalletConnector()).checkConnection();
      setWalletSetup({ status: "connected", summary });
    } catch (cause) {
      setWalletSetup(await walletFailure(cause));
    }
  };

  const connectForVerification = async () => {
    const connector = await getWalletConnector();
    try {
      const summary = await connector.checkConnection();
      setWalletSetup({ status: "connected", summary });
    } catch {
      const summary = await connector.connect();
      setWalletSetup({ status: "connected", summary });
    }
    return await connector.getProviders();
  };

  const createMidnightBinding = async (): Promise<MidnightBindingPort> => {
    if (import.meta.env.VITE_VEILRISK_E2E === "1") {
      const controller = (globalThis as E2EWindow).__veilriskE2EMidnightController;
      if (controller) {
        const { createE2EMidnightBinding } = await import("../lib/e2e-midnight-binding");
        return createE2EMidnightBinding(controller);
      }
    }
    const { createVeilRiskMidnightBinding } = await import("../lib/verification");
    if (!deploymentRecord.publicStateVerified || !deploymentRecord.contractAddress) {
      throw new Error("The verified Preprod contract configuration is unavailable.");
    }
    return createVeilRiskMidnightBinding({
      network: deploymentRecord.network,
      contractAddress: deploymentRecord.contractAddress,
      compiledAssetsBaseUrl: `${globalThis.location.origin}/contract/veilrisk`,
      connect: connectForVerification,
    });
  };

  const verifyOnMidnight = async () => {
    setHasLocalPreview(false);
    setValidationAttempted(true);
    setVerifiedResult(null);
    setVerificationMessage(null);
    setSubmittedTransactionId(null);

    if (!evaluation.passed) {
      setOnChainState({
        status: "invalid-locally",
        failureIds: evaluation.failures.map(({ id }) => id),
      });
      return;
    }
    if (!policyMatchesDeployment(policy)) {
      setOnChainState({ status: "failed", stage: "midnight" });
      setVerificationMessage(
        "On-chain verification uses the deployed 20% policy. Select that policy before continuing.",
      );
      return;
    }

    try {
      setOnChainState({ status: "wallet-connection-required" });
      const { verifyPortfolioOnMidnight } = await import("../lib/verification");
      const binding = await createMidnightBinding();
      const result = await verifyPortfolioOnMidnight(
        binding,
        { allocation, policy, policyName },
        (state) => {
          setOnChainState(state);
          if (state.status === "submitted") {
            setSubmittedTransactionId(state.transactionId);
          }
        },
      );
      if (result.status === "finalized") setVerifiedResult(result);
    } catch (cause) {
      const { getVerificationFailureMessage } = await import("../lib/verification");
      setVerificationMessage(getVerificationFailureMessage(cause));
    }
  };

  const publicPanelKicker = verifiedResult
    ? "Public attestation · Midnight Preprod"
    : "Private preview · not public";

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="VeilRisk home">
          <span className="brand-mark" aria-hidden="true">V</span><span>VeilRisk</span>
        </a>
        <div className="network-pill">
          <span className="network-dot" /> Midnight Preprod
          {walletSetup.status === "connected" ? " · Lace ready" : ""}
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">Private portfolio compliance</div>
        <h1>Prove the policy.<br /><span>Keep the portfolio.</span></h1>
        <p>Check locally, then generate a real Midnight proof against the verified Preprod policy contract.</p>
        <div className="privacy-flow" aria-label="VeilRisk privacy flow">
          <span>Private allocation</span><i>→</i><span>Local policy check</span><i>→</i><span>Midnight proof</span><i>→</i><span>Public success</span>
        </div>
      </section>

      <section className="workspace" aria-label="Portfolio compliance workspace">
        <div className="private-panel panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">Private · stays on device</span><h2>Portfolio allocation</h2></div>
            <span className={`total ${evaluation.total === BASIS_POINTS_TOTAL ? "valid" : "invalid"}`}>
              {formatBasisPoints(evaluation.total)} total
            </span>
          </div>

          <div className="preset-row">
            <button disabled={verificationBusy} onClick={() => { setAllocation(balancedPortfolio); clearResults(); }}>Balanced demo</button>
            <button disabled={verificationBusy} onClick={() => { setAllocation(concentratedPortfolio); clearResults(); }}>Risky demo</button>
          </div>

          <div className="allocation-list">
            {(Object.keys(allocation) as Array<keyof Allocation>).map((key) => (
              <label className="allocation-row" key={key}>
                <span>{labels[key]}</span>
                <div className="slider-wrap">
                  <input
                    type="range"
                    min="0"
                    max={BASIS_POINTS_TOTAL}
                    step="1"
                    value={allocation[key]}
                    disabled={verificationBusy}
                    onChange={(event) => updateAllocation(key, Number(event.target.value))}
                  />
                  <output>{formatBasisPoints(allocation[key])}</output>
                </div>
              </label>
            ))}
          </div>

          <div className="policy-box">
            <div><span className="panel-kicker">Public policy</span><h3>{policyName}</h3></div>
            <label>Speculative cap
              <select
                value={policy.maxSpeculative}
                disabled={verificationBusy}
                onChange={(event) => {
                  setPolicy((current) => ({
                    ...current,
                    maxSpeculative: Number(event.target.value),
                  }));
                  clearResults();
                }}
              >
                <option value="1000">10% · local only</option>
                <option value="2000">20% · deployed</option>
                <option value="3000">30% · local only</option>
              </select>
            </label>
          </div>

          <div className="wallet-box" aria-label="Lace wallet and proving setup">
            <div>
              <span className="panel-kicker">Midnight setup · Preprod</span>
              <h3>Lace wallet &amp; proving</h3>
            </div>
            {walletSetup.status === "connected" ? (
              <div className="wallet-status connected" role="status">
                <strong>{walletSetup.summary.walletName} connected</strong>
                <small>Wallet-delegated proving is ready. A signature is requested only after a valid proof is prepared.</small>
              </div>
            ) : walletSetup.status === "failed" ? (
              <div className="wallet-status failed" role="alert">
                <strong>Wallet setup incomplete</strong>
                <small>{walletSetup.message}</small>
              </div>
            ) : (
              <p>Connect Lace to prepare wallet-delegated proving. Connecting alone does not expose allocations or request a signature.</p>
            )}
            <div className="wallet-actions">
              <button type="button" onClick={connectWallet} disabled={walletSetup.status === "connecting" || verificationBusy}>
                {walletSetup.status === "connecting"
                  ? "Connecting…"
                  : walletSetup.status === "failed"
                    ? "Retry Lace connection"
                    : walletSetup.status === "connected"
                      ? "Reconnect Lace"
                      : "Connect Lace"}
              </button>
              {walletSetup.status === "connected" ? (
                <button type="button" onClick={checkWallet} disabled={verificationBusy}>Check connection</button>
              ) : null}
            </div>
          </div>

          <div className="local-check" aria-label="Private local policy results">
            <div className="local-check-heading">
              <div><span className="panel-kicker">Local evaluation</span><h3>Private policy details</h3></div>
              <strong className={evaluation.passed ? "local-pass" : "local-fail"}>
                {evaluation.passed ? "Ready" : "Needs changes"}
              </strong>
            </div>
            <div className="checks">
              {evaluation.checks.map((check) => (
                <div className="check" key={check.id}>
                  <span className={check.passed ? "check-pass" : "check-fail"}>{check.passed ? "✓" : "×"}</span>
                  <div><strong>{check.label}</strong><small>{check.publicDetail}</small></div>
                </div>
              ))}
            </div>
          </div>

          {validationAttempted && !evaluation.passed ? (
            <p className="validation-message" role="alert">This portfolio failed locally. Fix the private policy details before creating any public record.</p>
          ) : null}

          <div className="verification-actions">
            <button className="preview-button" onClick={createLocalPreview} disabled={verificationBusy}>
              Create private local preview
            </button>
            <button className="prove-button" onClick={verifyOnMidnight} disabled={verificationBusy}>
              {verificationLabel(onChainState)}
            </button>
          </div>
          <p className="local-note">Only a valid portfolio using the deployed 20% policy can reach Lace. Exact allocation values remain private proof inputs.</p>
        </div>

        <div className="public-panel panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">{publicPanelKicker}</span><h2>Compliance attestation</h2></div>
            <span className="shield" aria-hidden="true">◇</span>
          </div>

          {verifiedResult ? (
            <div className="proof-result passed" aria-live="polite">
              <div className="result-icon">✓</div>
              <span className="result-label">Verified on Midnight Preprod</span>
              <h3>Compliant on-chain</h3>
              <div className="proof-meta">
                <span>Policy</span><strong>{verifiedResult.attestation.policyName}</strong>
                <span>Network</span><strong>{verifiedResult.transaction.network}</strong>
                <span>Contract</span><code>{verifiedResult.transaction.contractAddress}</code>
                <span>Transaction</span><code>{verifiedResult.transaction.transactionId}</code>
                <span>Holdings disclosed</span><strong>None</strong>
              </div>
            </div>
          ) : onChainState.status !== "idle" && onChainState.status !== "invalid-locally" ? (
            <div className={`proof-result ${onChainState.status === "failed" ? "failed" : "pending"}`} aria-live="polite">
              <div className="result-icon">{onChainState.status === "failed" ? "×" : "◌"}</div>
              <span className="result-label">Midnight Preprod verification</span>
              <h3>{verificationLabel(onChainState)}</h3>
              {submittedTransactionId ? (
                <div className="proof-meta">
                  <span>Transaction</span><code>{submittedTransactionId}</code>
                  <span>Holdings disclosed</span><strong>None</strong>
                </div>
              ) : null}
              {verificationMessage ? <p className="verification-error" role="alert">{verificationMessage}</p> : null}
            </div>
          ) : hasLocalPreview ? (
            <div className="proof-result passed" aria-live="polite">
              <div className="result-icon">✓</div>
              <span className="result-label">Private local preview · not on-chain</span>
              <h3>Compliant locally</h3>
              <div className="proof-meta">
                <span>Evaluation</span><strong>Deterministic local policy</strong>
                <span>Network</span><strong>Not submitted</strong>
                <span>Holdings disclosed</span><strong>None</strong>
              </div>
            </div>
          ) : (
            <div className="empty-proof">
              <div className="proof-orbit"><span /></div>
              <h3>No attestation</h3>
              <p>Check privately first, or verify a compliant portfolio against the deployed Preprod contract.</p>
            </div>
          )}

          {hasLocalPreview || verifiedResult ? (
            <div className="privacy-summary" aria-label="Privacy-safe summary">
              <div className="privacy-summary-heading"><span>LOCAL</span><strong>Deterministic privacy summary</strong></div>
              <p>
                {verifiedResult
                  ? "The finalized transaction proves compliance with the public policy. Exact holdings and allocation values remain private."
                  : "The local preview satisfies the selected policy. Exact holdings and allocation values remain private."}
              </p>
              <small>Generated locally from evaluation state. No external explanation service receives portfolio data.</small>
            </div>
          ) : null}
        </div>
      </section>

      <section className="how-it-works">
        <div><span>01</span><h3>Set a policy</h3><p>Limits are public, explicit, and independently verifiable.</p></div>
        <div><span>02</span><h3>Check locally</h3><p>Invalid portfolios stop in the browser without creating a public record.</p></div>
        <div><span>03</span><h3>Verify on-chain</h3><p>A successful Midnight transaction publishes compliance without the private allocation.</p></div>
      </section>

      <footer><span>Built for Midnight Hackathon · August 2026</span><span>Private by design, verifiable by anyone.</span></footer>
    </main>
  );
}
