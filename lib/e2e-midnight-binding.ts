import type { Allocation, RiskPolicy } from "./risk.ts";
import {
  MidnightLifecycleError,
  type ExternalStage,
  type MidnightBindingPort,
} from "./verification.ts";

export type E2EMidnightController = {
  calls: string[];
  failOnceAt?: ExternalStage;
  failed?: boolean;
  pauseAt?: "proof" | "signature" | "submission" | "finalization";
  privateInput?: Readonly<{ allocation: Allocation; policy: RiskPolicy }>;
};

async function pauseAt(
  controller: E2EMidnightController,
  stage: E2EMidnightController["pauseAt"],
) {
  if (controller.pauseAt !== stage) return;
  await new Promise<void>((resolve) => {
    globalThis.addEventListener(`veilrisk:e2e:continue:${stage}`, () => resolve(), {
      once: true,
    });
  });
}

function failOnce(
  controller: E2EMidnightController,
  stage: "proof" | "signature" | "submission" | "finalization",
) {
  if (controller.failOnceAt === stage && !controller.failed) {
    controller.failed = true;
    throw new MidnightLifecycleError(
      stage,
      new Error("Private deterministic E2E failure detail"),
    );
  }
}

export function createE2EMidnightBinding(
  controller: E2EMidnightController,
): MidnightBindingPort {
  return {
    async connect() {
      controller.calls.push("wallet");
      if (controller.failOnceAt === "wallet" && !controller.failed) {
        controller.failed = true;
        throw new Error("Private deterministic E2E wallet detail");
      }
      return {};
    },
    async submitCompliance(_providers, input, onState = () => {}) {
      controller.privateInput = {
        allocation: { ...input.allocation },
        policy: { ...input.policy },
      };

      onState({ status: "generating-proof" });
      controller.calls.push("proof");
      await pauseAt(controller, "proof");
      failOnce(controller, "proof");

      onState({ status: "awaiting-signature" });
      controller.calls.push("signature");
      await pauseAt(controller, "signature");
      failOnce(controller, "signature");

      onState({ status: "submitting" });
      controller.calls.push("submission");
      await pauseAt(controller, "submission");
      failOnce(controller, "submission");

      const transactionId = "public_compliance_transaction_id";
      onState({ status: "submitted", transactionId });
      controller.calls.push("finalization");
      await pauseAt(controller, "finalization");
      failOnce(controller, "finalization");

      return {
        transactionId,
        network: "preprod",
        contractAddress: "3e3ab54fd9383a11b457cc48b73e084db0aaf63ad3499c149cc1b43e1cf4e4f6",
      };
    },
  };
}
