import type {
  ContractAddress,
  SigningKey,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

/**
 * Deployment creates a maintenance signing key even for this fixed-policy
 * contract. Keep it only for the lifetime of the deployment command: VeilRisk
 * has no maintenance workflow and must not persist private signing material.
 */
export class EphemeralDeploymentPrivateStateProvider {
  #signingKeys = new Map<ContractAddress, SigningKey>();

  setContractAddress(address: ContractAddress) {
    void address;
  }

  async setSigningKey(address: ContractAddress, signingKey: SigningKey) {
    this.#signingKeys.set(address, signingKey);
  }

  async getSigningKey(address: ContractAddress) {
    return this.#signingKeys.get(address) ?? null;
  }

  async removeSigningKey(address: ContractAddress) {
    this.#signingKeys.delete(address);
  }

  async clearSigningKeys() {
    this.#signingKeys.clear();
  }
}
