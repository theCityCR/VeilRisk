"use client";

import { useRef, useState } from "react";
import type { DeploymentReceipt, DeploymentState, VerifiedDeployment } from "../../lib/deployment";
import type { LaceConnectorPort } from "../../lib/verification";
import { DEFAULT_POLICY, formatBasisPoints } from "../../lib/risk";

type DeployViewState =
  | { status: "idle" }
  | { status: "working"; message: string }
  | { status: "failed"; message: string; receipt?: DeploymentReceipt }
  | { status: "finalized"; deployment: VerifiedDeployment };

const statusMessages: Record<DeploymentState["status"], string> = {
  "connecting-wallet": "Connecting to Lace on Preprod…",
  "awaiting-deployment": "Generating the deployment and awaiting wallet approval…",
  "verifying-public-state": "Deployment finalized. Verifying the indexed public policy…",
  finalized: "Deployment finalized and its public policy was verified.",
  failed: "Deployment did not complete.",
};

export default function DeployPolicyContract() {
  const [view, setView] = useState<DeployViewState>({ status: "idle" });
  const connector = useRef<LaceConnectorPort | null>(null);

  const deploy = async () => {
    setView({ status: "working", message: statusMessages["connecting-wallet"] });
    try {
      const [{ createVeilRiskDeployment }, { createBrowserLaceConnector }] = await Promise.all([
        import("../../lib/deployment"),
        import("../../lib/verification"),
      ]);
      connector.current ??= createBrowserLaceConnector();
      const deployment = createVeilRiskDeployment({
        network: "preprod",
        compiledAssetsBaseUrl: `${globalThis.location.origin}/contract/veilrisk`,
        connect: async () => {
          await connector.current?.connect();
          if (!connector.current) throw new Error("Lace connector is unavailable.");
          return connector.current.getProviders() as never;
        },
      });

      const result = await deployment(DEFAULT_POLICY, (state) => {
        if (state.status === "finalized") {
          setView({ status: "finalized", deployment: state.deployment });
        } else if (state.status !== "failed") {
          setView({ status: "working", message: statusMessages[state.status] });
        }
      });
      setView({ status: "finalized", deployment: result });
    } catch (cause) {
      const { DeploymentError } = await import("../../lib/deployment");
      const receipt = cause instanceof DeploymentError ? cause.receipt : undefined;
      setView({
        status: "failed",
        receipt,
        message: receipt
          ? "The transaction finalized, but its indexed public policy could not be confirmed. Keep the public identifiers below and retry inspection before using this contract."
          : "No verified deployment was produced. Check Lace, its Preprod balance, and the configured proving service, then retry.",
      });
    }
  };

  const receipt = view.status === "finalized" ? view.deployment : view.status === "failed" ? view.receipt : undefined;

  return (
    <main className="deploy-page">
      <header className="site-header">
        {/* Vinext currently hydrates next/link with a duplicate React instance on nested routes. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="brand" href="/" aria-label="Back to VeilRisk">
          <span className="brand-mark" aria-hidden="true">V</span><span>VeilRisk</span>
        </a>
        <div className="network-pill"><span className="network-dot" /> Preprod deployment</div>
      </header>

      <section className="deploy-shell">
        <div className="panel deploy-card">
          <span className="panel-kicker">One-time operator action</span>
          <h1>Deploy the public risk policy</h1>
          <p>
            Lace will generate, approve, submit, and finalize a real Midnight Preprod
            deployment. This action may consume Preprod funds.
          </p>

          <div className="deployment-policy" aria-label="Policy to deploy">
            <div><span>Speculative cap</span><strong>{formatBasisPoints(DEFAULT_POLICY.maxSpeculative)}</strong></div>
            <div><span>Growth cap</span><strong>{formatBasisPoints(DEFAULT_POLICY.maxGrowth)}</strong></div>
            <div><span>Single-bucket cap</span><strong>{formatBasisPoints(DEFAULT_POLICY.maxSingleBucket)}</strong></div>
          </div>

          <div className="privacy-callout">
            <strong>Public deployment only</strong>
            <p>The policy limits, contract address, and transaction ID are public. No portfolio allocation is used in this deployment.</p>
          </div>

          {view.status === "working" ? <p className="deploy-status" role="status">{view.message}</p> : null}
          {view.status === "failed" ? <p className="validation-message" role="alert">{view.message}</p> : null}
          {view.status === "finalized" ? (
            <p className="deploy-success" role="status">Deployment finalized and indexed policy verified.</p>
          ) : null}

          {receipt ? (
            <dl className="deployment-receipt" aria-label="Public deployment receipt">
              <div><dt>Network</dt><dd>{receipt.network}</dd></div>
              <div><dt>Contract address</dt><dd>{receipt.contractAddress}</dd></div>
              <div><dt>Transaction ID</dt><dd>{receipt.transactionId}</dd></div>
            </dl>
          ) : null}

          <button className="prove-button" type="button" onClick={deploy} disabled={view.status === "working" || view.status === "finalized"}>
            {view.status === "working"
              ? "Deployment in progress…"
              : view.status === "failed"
                ? "Retry deployment"
                : view.status === "finalized"
                  ? "Policy contract deployed"
                  : "Connect Lace and deploy"}
          </button>
          <p className="local-note">Only continue if Lace is configured for Preprod and the displayed limits are correct.</p>
        </div>
      </section>
    </main>
  );
}
