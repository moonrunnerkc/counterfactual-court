import { createHash } from 'node:crypto';

/**
 * Recursively rebuild a value with sorted object keys so JSON.stringify produces
 * the canonical form. Arrays preserve order; primitives are returned as-is.
 *
 * BigInt and `undefined` inside objects are rejected upstream by JSON.stringify;
 * we surface its native errors rather than silently coercing.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

/**
 * Serialize a value to canonical JSON: object keys sorted lexicographically at
 * every level, no whitespace, default JSON.stringify number formatting. Two
 * objects that differ only in key insertion order produce byte-identical output.
 *
 * @param value Any JSON-compatible value.
 * @returns Canonical JSON string.
 * @throws If the value contains BigInt, circular references, or other
 *   JSON.stringify-rejected shapes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Compute the lowercase hex SHA-256 of a string or byte buffer. Strings are
 * encoded UTF-8 before hashing.
 *
 * @param input Bytes or UTF-8 text to hash.
 * @returns 64-character lowercase hex digest.
 */
export function sha256Hex(input: string | Uint8Array): string {
  const hash = createHash('sha256');
  if (typeof input === 'string') {
    hash.update(input, 'utf8');
  } else {
    hash.update(input);
  }
  return hash.digest('hex');
}

/**
 * Compute a content hash that is stable across object key permutations.
 * Equivalent to `sha256Hex(canonicalJson(value))`.
 *
 * @param value Any JSON-compatible value.
 * @returns 64-character lowercase hex digest of the canonical JSON.
 */
export function contentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
