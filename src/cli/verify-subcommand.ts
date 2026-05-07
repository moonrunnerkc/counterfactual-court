import { loadSignedBundle, verifyBundleSignature } from '../runtime/bundle-replayer.js';

/** Outcome reported by {@link executeVerify}. */
export interface VerifyOutcome {
  readonly bundleId: string;
  readonly signatureOk: boolean;
  readonly reason: string;
}

/**
 * Execute the `gemmacourt verify` subcommand. Reads the bundle, runs the
 * Ed25519 check, and returns whether the signature verifies. No LLM calls
 * are made; this is the cheap path for confirming a bundle has not been
 * tampered with.
 *
 * @param bundlePath Absolute path to the `.verdict` file.
 * @returns A {@link VerifyOutcome}.
 */
export function executeVerify(bundlePath: string): VerifyOutcome {
  const bundle = loadSignedBundle(bundlePath);
  const sig = verifyBundleSignature(bundle);
  return { bundleId: bundle.body.id, signatureOk: sig.ok, reason: sig.reason };
}
