"use client";

import { useMemo, useState } from "react";
import { DEFAULT_POLICY, evaluatePortfolio, type Allocation, type RiskPolicy } from "../lib/risk";

const balancedPortfolio: Allocation = { cash: 15, bonds: 25, equities: 50, speculative: 10 };
const concentratedPortfolio: Allocation = { cash: 5, bonds: 5, equities: 55, speculative: 35 };
const labels: Record<keyof Allocation, string> = {
  cash: "Cash",
  bonds: "Bonds",
  equities: "Equities",
  speculative: "Speculative",
};

type Attestation = { id: string; createdAt: string; passed: boolean };

export default function Home() {
  const [allocation, setAllocation] = useState<Allocation>(balancedPortfolio);
  const [policy, setPolicy] = useState<RiskPolicy>(DEFAULT_POLICY);
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const [isProving, setIsProving] = useState(false);
  const evaluation = useMemo(() => evaluatePortfolio(allocation, policy), [allocation, policy]);

  const updateAllocation = (key: keyof Allocation, value: number) => {
    setAllocation((current) => ({ ...current, [key]: value }));
    setAttestation(null);
  };

  const generateProof = () => {
    setIsProving(true);
    setAttestation(null);
    window.setTimeout(() => {
      setAttestation({
        id: `vr_${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`,
        createdAt: new Date().toISOString(),
        passed: evaluation.passed,
      });
      setIsProving(false);
    }, 700);
  };

  const disclosure = evaluation.passed
    ? "The portfolio satisfies every selected policy. Exact holdings and allocation values remain private."
    : evaluation.failures.map((failure) => failure.publicMessage).join(" ");

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="VeilRisk home">
          <span className="brand-mark" aria-hidden="true">V</span><span>VeilRisk</span>
        </a>
        <div className="network-pill"><span className="network-dot" /> Midnight · Preprod</div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">Private portfolio compliance</div>
        <h1>Prove the policy.<br /><span>Keep the portfolio.</span></h1>
        <p>Generate a zero-knowledge risk attestation without publishing the holdings used to create it.</p>
        <div className="privacy-flow" aria-label="VeilRisk privacy flow">
          <span>Private allocation</span><i>→</i><span>Local proof</span><i>→</i><span>Public attestation</span>
        </div>
      </section>

      <section className="workspace" aria-label="Portfolio compliance workspace">
        <div className="private-panel panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">Private · stays on device</span><h2>Portfolio allocation</h2></div>
            <span className={`total ${evaluation.total === 100 ? "valid" : "invalid"}`}>{evaluation.total}% total</span>
          </div>

          <div className="preset-row">
            <button onClick={() => { setAllocation(balancedPortfolio); setAttestation(null); }}>Balanced demo</button>
            <button onClick={() => { setAllocation(concentratedPortfolio); setAttestation(null); }}>Risky demo</button>
          </div>

          <div className="allocation-list">
            {(Object.keys(allocation) as Array<keyof Allocation>).map((key) => (
              <label className="allocation-row" key={key}>
                <span>{labels[key]}</span>
                <div className="slider-wrap">
                  <input type="range" min="0" max="100" value={allocation[key]}
                    onChange={(event) => updateAllocation(key, Number(event.target.value))} />
                  <output>{allocation[key]}%</output>
                </div>
              </label>
            ))}
          </div>

          <div className="policy-box">
            <div><span className="panel-kicker">Public policy</span><h3>Conservative mandate</h3></div>
            <label>Speculative cap
              <select value={policy.maxSpeculative} onChange={(event) => {
                setPolicy((current) => ({ ...current, maxSpeculative: Number(event.target.value) }));
                setAttestation(null);
              }}>
                <option value="10">10%</option><option value="20">20%</option><option value="30">30%</option>
              </select>
            </label>
          </div>

          <button className="prove-button" onClick={generateProof} disabled={isProving}>
            {isProving ? "Generating proof…" : "Generate private attestation"}
          </button>
          <p className="local-note">Raw allocations are not written to the public ledger.</p>
        </div>

        <div className="public-panel panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">Public · safe to share</span><h2>Risk attestation</h2></div>
            <span className="shield" aria-hidden="true">◇</span>
          </div>

          {!attestation ? (
            <div className="empty-proof">
              <div className="proof-orbit"><span /></div>
              <h3>No proof generated</h3>
              <p>Select a portfolio and create an attestation. Only the policy result will appear here.</p>
            </div>
          ) : (
            <div className={`proof-result ${attestation.passed ? "passed" : "failed"}`}>
              <div className="result-icon">{attestation.passed ? "✓" : "!"}</div>
              <span className="result-label">{attestation.passed ? "Policy verified" : "Policy not satisfied"}</span>
              <h3>{attestation.passed ? "Compliant" : "Action required"}</h3>
              <div className="proof-meta">
                <span>Attestation</span><code>{attestation.id}</code>
                <span>Network</span><strong>Midnight Preprod</strong>
                <span>Holdings disclosed</span><strong>None</strong>
              </div>
            </div>
          )}

          <div className="checks">
            {evaluation.checks.map((check) => (
              <div className="check" key={check.id}>
                <span className={check.passed ? "check-pass" : "check-fail"}>{check.passed ? "✓" : "×"}</span>
                <div><strong>{check.label}</strong><small>{check.publicDetail}</small></div>
              </div>
            ))}
          </div>

          <div className="ai-brief">
            <div className="ai-heading"><span>AI</span><strong>Selective-disclosure brief</strong></div>
            <p>{disclosure}</p>
            <small>The assistant receives policy outcomes, never the raw allocation.</small>
          </div>
        </div>
      </section>

      <section className="how-it-works">
        <div><span>01</span><h3>Set a policy</h3><p>Limits are public, explicit, and independently verifiable.</p></div>
        <div><span>02</span><h3>Prove locally</h3><p>Private allocations become inputs to a Compact zero-knowledge circuit.</p></div>
        <div><span>03</span><h3>Share the result</h3><p>Anyone can verify compliance without learning the underlying portfolio.</p></div>
      </section>

      <footer><span>Built for Midnight Hackathon · August 2026</span><span>Private by design, verifiable by anyone.</span></footer>
    </main>
  );
}
