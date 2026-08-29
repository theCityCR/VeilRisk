"use client";

import { useMemo, useState } from "react";
import { BASIS_POINTS_TOTAL, DEFAULT_POLICY, evaluatePortfolio, formatBasisPoints, type Allocation, type RiskPolicy } from "../lib/risk";

const balancedPortfolio: Allocation = { cash: 1_500, bonds: 2_500, equities: 5_000, speculative: 1_000 };
const concentratedPortfolio: Allocation = { cash: 500, bonds: 500, equities: 5_500, speculative: 3_500 };
const labels: Record<keyof Allocation, string> = {
  cash: "Cash",
  bonds: "Bonds",
  equities: "Equities",
  speculative: "Speculative",
};

export default function Home() {
  const [allocation, setAllocation] = useState<Allocation>(balancedPortfolio);
  const [policy, setPolicy] = useState<RiskPolicy>(DEFAULT_POLICY);
  const [hasLocalPreview, setHasLocalPreview] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const evaluation = useMemo(() => evaluatePortfolio(allocation, policy), [allocation, policy]);

  const clearLocalPreview = () => {
    setHasLocalPreview(false);
    setValidationAttempted(false);
  };

  const updateAllocation = (key: keyof Allocation, value: number) => {
    setAllocation((current) => ({ ...current, [key]: value }));
    clearLocalPreview();
  };

  const createLocalPreview = () => {
    setHasLocalPreview(false);
    setValidationAttempted(true);

    if (evaluation.passed) {
      setHasLocalPreview(true);
    }
  };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="VeilRisk home">
          <span className="brand-mark" aria-hidden="true">V</span><span>VeilRisk</span>
        </a>
        <div className="network-pill"><span className="network-dot" /> Local prototype</div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">Private portfolio compliance</div>
        <h1>Prove the policy.<br /><span>Keep the portfolio.</span></h1>
        <p>Preview portfolio compliance locally. On-chain Midnight verification is the next integration milestone.</p>
        <div className="privacy-flow" aria-label="VeilRisk privacy flow">
          <span>Private allocation</span><i>→</i><span>Local policy check</span><i>→</i><span>On-chain attestation · planned</span>
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
            <button onClick={() => { setAllocation(balancedPortfolio); clearLocalPreview(); }}>Balanced demo</button>
            <button onClick={() => { setAllocation(concentratedPortfolio); clearLocalPreview(); }}>Risky demo</button>
          </div>

          <div className="allocation-list">
            {(Object.keys(allocation) as Array<keyof Allocation>).map((key) => (
              <label className="allocation-row" key={key}>
                <span>{labels[key]}</span>
                <div className="slider-wrap">
                  <input type="range" min="0" max={BASIS_POINTS_TOTAL} step="1" value={allocation[key]}
                    onChange={(event) => updateAllocation(key, Number(event.target.value))} />
                  <output>{formatBasisPoints(allocation[key])}</output>
                </div>
              </label>
            ))}
          </div>

          <div className="policy-box">
            <div><span className="panel-kicker">Public policy</span><h3>Conservative mandate</h3></div>
            <label>Speculative cap
              <select value={policy.maxSpeculative} onChange={(event) => {
                setPolicy((current) => ({ ...current, maxSpeculative: Number(event.target.value) }));
                clearLocalPreview();
              }}>
                <option value="1000">10%</option><option value="2000">20%</option><option value="3000">30%</option>
              </select>
            </label>
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
            <p className="validation-message" role="alert">This portfolio failed locally. Fix the private policy details before creating a preview.</p>
          ) : null}

          <button className="prove-button" onClick={createLocalPreview}>
            Create local compliance preview
          </button>
          <p className="local-note">This local check does not generate a proof, request a wallet signature, or submit a transaction.</p>
        </div>

        <div className="public-panel panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">Shareable preview · not on-chain</span><h2>Compliance preview</h2></div>
            <span className="shield" aria-hidden="true">◇</span>
          </div>

          {!hasLocalPreview ? (
            <div className="empty-proof">
              <div className="proof-orbit"><span /></div>
              <h3>No local preview</h3>
              <p>A compliant portfolio can create a local preview. On-chain verification is not connected yet.</p>
            </div>
          ) : (
            <div className="proof-result passed" aria-live="polite">
              <div className="result-icon">✓</div>
              <span className="result-label">Local preview · not verified on-chain</span>
              <h3>Compliant locally</h3>
              <div className="proof-meta">
                <span>Evaluation</span><strong>Deterministic local policy</strong>
                <span>Network</span><strong>Not submitted</strong>
                <span>Holdings disclosed</span><strong>None</strong>
              </div>
            </div>
          )}

          {hasLocalPreview ? (
            <div className="ai-brief">
              <div className="ai-heading"><span>AI</span><strong>Selective-disclosure preview</strong></div>
              <p>The portfolio satisfies every selected policy. Exact holdings and allocation values remain private.</p>
              <small>No AI request is sent in this prototype. A future request will contain approved policy outcomes only.</small>
            </div>
          ) : null}
        </div>
      </section>

      <section className="how-it-works">
        <div><span>01</span><h3>Set a policy</h3><p>Limits are public, explicit, and independently verifiable.</p></div>
        <div><span>02</span><h3>Check locally</h3><p>Invalid portfolios stop in the browser without creating a public record.</p></div>
        <div><span>03</span><h3>Verify on-chain</h3><p>The planned Midnight integration will publish a successful result without the private allocation.</p></div>
      </section>

      <footer><span>Built for Midnight Hackathon · August 2026</span><span>Private by design, verifiable by anyone.</span></footer>
    </main>
  );
}
