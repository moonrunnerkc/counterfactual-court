import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import { sha256Hex } from './canonical.js';

/** Header bytes prepended to a 32-byte Ed25519 seed to form a PKCS8 DER private key. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Header bytes prepended to a 32-byte Ed25519 raw public key to form an SPKI DER. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Derive a deterministic 32-byte Ed25519 seed from a string seed. Used so two
 * runs of the same bundle produce the same keypair and therefore the same
 * signature, preserving bit-identical replay.
 *
 * @param seedString Caller-supplied seed (the run's base seed plus a
 *                   purpose tag like `bundle-signing`).
 * @returns 32 bytes of seed material derived via SHA-256.
 */
function deriveSeedBytes(seedString: string): Buffer {
  return Buffer.from(sha256Hex(seedString), 'hex');
}

/** A keypair plus the raw 32-byte public key bytes for embedding in a bundle. */
export interface Ed25519Keypair {
  /** PKCS8 DER private key, ready for `crypto.sign('Ed25519', ...)`. */
  readonly privateKeyDer: Buffer;
  /** Raw 32-byte public key (the `x` half of the keypair). */
  readonly publicKeyRaw: Buffer;
}

/**
 * Build a deterministic Ed25519 keypair from a string seed. The same seed
 * always produces the same keypair, which is the property that makes
 * bit-identical signed bundle replay possible.
 *
 * @param seedString Caller-supplied seed.
 * @returns A {@link Ed25519Keypair} suitable for {@link signCanonical}.
 */
export function deriveEd25519Keypair(seedString: string): Ed25519Keypair {
  const seed = deriveSeedBytes(seedString);
  const privateKeyDer = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  const privateKey = createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const publicKeyRaw = Buffer.from(spki.subarray(spki.length - 32));
  return { privateKeyDer, publicKeyRaw };
}

/**
 * Sign canonical JSON bytes with the supplied keypair.
 *
 * @param canonicalBytes Canonical UTF-8 JSON of the value being signed.
 * @param keypair        Keypair from {@link deriveEd25519Keypair}.
 * @returns 64-byte Ed25519 signature.
 */
export function signCanonical(canonicalBytes: Buffer, keypair: Ed25519Keypair): Buffer {
  const privateKey = createPrivateKey({
    key: keypair.privateKeyDer,
    format: 'der',
    type: 'pkcs8',
  });
  return cryptoSign(null, canonicalBytes, privateKey);
}

/**
 * Verify a signature over canonical JSON bytes given the raw 32-byte public
 * key from a bundle.
 *
 * @param canonicalBytes Canonical UTF-8 JSON of the value that was signed.
 * @param signature      64-byte Ed25519 signature emitted by {@link signCanonical}.
 * @param publicKeyRaw   32-byte raw public key (e.g. from a bundle).
 * @returns true if the signature verifies, false otherwise.
 */
export function verifyCanonical(
  canonicalBytes: Buffer,
  signature: Buffer,
  publicKeyRaw: Buffer,
): boolean {
  if (publicKeyRaw.length !== 32) return false;
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, publicKeyRaw]);
  const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  return cryptoVerify(null, canonicalBytes, publicKey, signature);
}
