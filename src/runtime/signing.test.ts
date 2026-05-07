import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical.js';
import { deriveEd25519Keypair, signCanonical, verifyCanonical } from './signing.js';

describe('Ed25519 deterministic signing', () => {
  it('derives the same keypair from the same seed', () => {
    const a = deriveEd25519Keypair('seed-one');
    const b = deriveEd25519Keypair('seed-one');
    expect(a.publicKeyRaw.equals(b.publicKeyRaw)).toBe(true);
    expect(a.privateKeyDer.equals(b.privateKeyDer)).toBe(true);
  });

  it('derives different keypairs from different seeds', () => {
    const a = deriveEd25519Keypair('seed-one');
    const b = deriveEd25519Keypair('seed-two');
    expect(a.publicKeyRaw.equals(b.publicKeyRaw)).toBe(false);
  });

  it('signs and verifies canonical JSON bytes round-trip', () => {
    const kp = deriveEd25519Keypair('round-trip');
    const body = { event: 'hello', n: 42, items: [3, 1, 2] };
    const bytes = Buffer.from(canonicalJson(body), 'utf8');
    const sig = signCanonical(bytes, kp);
    expect(sig.length).toBe(64);
    expect(verifyCanonical(bytes, sig, kp.publicKeyRaw)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const kp = deriveEd25519Keypair('round-trip');
    const sig = signCanonical(Buffer.from(canonicalJson({ a: 1 }), 'utf8'), kp);
    expect(
      verifyCanonical(Buffer.from(canonicalJson({ a: 2 }), 'utf8'), sig, kp.publicKeyRaw),
    ).toBe(false);
  });

  it('produces a stable signature across runs of the same seed and payload', () => {
    const body = { hello: 'world', n: 1 };
    const bytes = Buffer.from(canonicalJson(body), 'utf8');
    const a = signCanonical(bytes, deriveEd25519Keypair('stable'));
    const b = signCanonical(bytes, deriveEd25519Keypair('stable'));
    expect(a.equals(b)).toBe(true);
  });
});
