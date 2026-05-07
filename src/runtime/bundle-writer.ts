import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { canonicalJson } from './canonical.js';
import { type BundleBody, type SignedBundle } from './bundle-schema.js';
import { deriveEd25519Keypair, signCanonical } from './signing.js';

/**
 * Serialize a {@link BundleBody}, sign it with a deterministic Ed25519
 * keypair derived from `baseSeed`, and emit the {@link SignedBundle} envelope
 * the writer/replayer/verifier all consume. Pure: no I/O.
 *
 * @param body     Bundle body produced by the orchestrator.
 * @param baseSeed Run base seed; the signing keypair is `sha256(baseSeed +
 *                 ":bundle-signing")` so two runs of the same bundle produce
 *                 the same signature.
 * @returns Signed bundle envelope plus the canonical body bytes that were signed.
 */
export function signBundle(
  body: BundleBody,
  baseSeed: string,
): { readonly bundle: SignedBundle; readonly canonicalBodyBytes: Buffer } {
  const canonical = canonicalJson(body);
  const canonicalBodyBytes = Buffer.from(canonical, 'utf8');
  const keypair = deriveEd25519Keypair(`${baseSeed}:bundle-signing`);
  const signature = signCanonical(canonicalBodyBytes, keypair);
  const bundle: SignedBundle = {
    body,
    signature: {
      alg: 'Ed25519',
      publicKeyB64: keypair.publicKeyRaw.toString('base64'),
      valueB64: signature.toString('base64'),
    },
  };
  return { bundle, canonicalBodyBytes };
}

/**
 * Persist a signed bundle to disk as a `.verdict` file. The on-disk encoding
 * is canonical JSON of the {@link SignedBundle} envelope so any reader gets
 * byte-identical content for the same input.
 *
 * @param bundle Signed bundle envelope from {@link signBundle}.
 * @param dir    Target directory; created recursively if absent.
 * @returns Absolute path to the file written.
 */
export function writeBundleFile(bundle: SignedBundle, dir: string): string {
  const absDir = resolve(dir);
  mkdirSync(absDir, { recursive: true });
  const fileName = `${bundle.body.id}.verdict`;
  const filePath = join(absDir, fileName);
  writeFileSync(filePath, canonicalJson(bundle), 'utf8');
  return filePath;
}

/**
 * Convenience wrapper: sign and write a bundle in one call. Used by the CLI's
 * `run` subcommand.
 *
 * @param body     Body produced by the orchestrator.
 * @param baseSeed Run base seed.
 * @param dir      Target directory.
 * @returns The written file path plus the in-memory signed bundle.
 */
export function writeSignedBundle(
  body: BundleBody,
  baseSeed: string,
  dir: string,
): { readonly path: string; readonly bundle: SignedBundle } {
  const { bundle } = signBundle(body, baseSeed);
  const path = writeBundleFile(bundle, dir);
  return { path, bundle };
}

/** Re-export so callers can access the bundle parent directory consistently. */
export const ensureBundleDir = (dir: string): string => {
  const abs = resolve(dir);
  mkdirSync(dirname(abs), { recursive: true });
  mkdirSync(abs, { recursive: true });
  return abs;
};
