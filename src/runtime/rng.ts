import { createHash } from 'node:crypto';

const U64_MASK = (1n << 64n) - 1n;
const U64_TWO_53 = 2 ** 53;
const U64_HIGH_53_SHIFT = 11n;
const U64_TOP_BITS_FOR_INT = 32n;

/**
 * Mask a bigint into the unsigned 64-bit range. JavaScript bigints have no
 * fixed width, so every arithmetic step in the PRNG must re-clamp.
 */
function u64(x: bigint): bigint {
  return x & U64_MASK;
}

/** Rotate-left within the unsigned 64-bit range. */
function rotl(x: bigint, k: bigint): bigint {
  const v = u64(x);
  return u64((v << k) | (v >> (64n - k)));
}

/**
 * One step of SplitMix64. Returns the mixed output value plus the next state.
 * Used solely to expand a single u64 seed into the four-word xoshiro256**
 * state; xoshiro requires the state not be all-zero, and SplitMix64 produces
 * good avalanche from any non-zero seed.
 */
function splitMix64Step(state: bigint): { value: bigint; next: bigint } {
  const next = u64(state + 0x9e3779b97f4a7c15n);
  let z = next;
  z = u64((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
  z = u64((z ^ (z >> 27n)) * 0x94d049bb133111ebn);
  z = u64(z ^ (z >> 31n));
  return { value: z, next };
}

/** Build the four-word xoshiro256** state from a single u64 seed. */
function xoshiroStateFromSeed(seed: bigint): [bigint, bigint, bigint, bigint] {
  let cur = u64(seed);
  const r0 = splitMix64Step(cur);
  cur = r0.next;
  const r1 = splitMix64Step(cur);
  cur = r1.next;
  const r2 = splitMix64Step(cur);
  cur = r2.next;
  const r3 = splitMix64Step(cur);
  return [r0.value, r1.value, r2.value, r3.value];
}

/** One step of xoshiro256**. Mutates the state array in place and returns u64. */
function xoshiroNext(state: [bigint, bigint, bigint, bigint]): bigint {
  const result = u64(rotl(u64(state[1] * 5n), 7n) * 9n);
  const t = u64(state[1] << 17n);
  state[2] = u64(state[2] ^ state[0]);
  state[3] = u64(state[3] ^ state[1]);
  state[1] = u64(state[1] ^ state[2]);
  state[0] = u64(state[0] ^ state[3]);
  state[2] = u64(state[2] ^ t);
  state[3] = rotl(state[3], 45n);
  return result;
}

/** Acceptable seed shapes. Strings are hashed with SHA-256. */
export type RngSeed = bigint | number | string;

/**
 * Convert a user-facing seed into a u64 bigint suitable for SplitMix64. Numbers
 * are required to be safe integers; strings are hashed so any human-readable
 * seed (e.g. "prosecutor") is acceptable.
 *
 * @param seed Seed value provided by the caller.
 * @returns A u64-clamped bigint representation of the seed.
 * @throws If `seed` is a non-integer or non-finite number.
 */
function normalizeSeed(seed: RngSeed): bigint {
  if (typeof seed === 'bigint') return u64(seed);
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
      throw new Error(
        `rng seed must be a finite integer; got ${String(seed)}; pass an integer or use a string seed`,
      );
    }
    return u64(BigInt(seed));
  }
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  let b = 0n;
  for (let i = 0; i < 8; i++) {
    b = (b << 8n) | BigInt(digest[i] ?? 0);
  }
  return u64(b);
}

/**
 * Seeded PRNG. xoshiro256** for the 64-bit core, with float and integer
 * convenience methods on top. All state is encapsulated; a fresh instance
 * created with the same seed produces an identical sequence forever.
 */
export interface Rng {
  /** Draw the next 64-bit unsigned integer as a bigint. */
  nextU64(): bigint;
  /** Draw a uniform random float in [0, 1) with 53-bit mantissa precision. */
  nextFloat(): number;
  /** Draw a uniform random integer in [minInclusive, maxExclusive). */
  nextInt(minInclusive: number, maxExclusive: number): number;
}

/**
 * Build a seeded {@link Rng}. Same seed implies identical sequence; this is
 * the only random source agent code is allowed to use.
 *
 * @param seed Bigint, integer number, or string seed. Strings are SHA-256 hashed.
 * @returns A fresh Rng with state initialized from the seed.
 * @throws If `seed` is a non-integer or non-finite number.
 */
export function createRng(seed: RngSeed): Rng {
  const state = xoshiroStateFromSeed(normalizeSeed(seed));
  return {
    nextU64: () => xoshiroNext(state),
    nextFloat: () => {
      const v = xoshiroNext(state) >> U64_HIGH_53_SHIFT;
      return Number(v) / U64_TWO_53;
    },
    nextInt: (minInclusive: number, maxExclusive: number) => {
      if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
        throw new Error(
          `rng nextInt requires integer bounds; got min=${String(minInclusive)}, max=${String(maxExclusive)}; pass integers`,
        );
      }
      if (maxExclusive <= minInclusive) {
        throw new Error(
          `rng nextInt requires max > min; got min=${minInclusive}, max=${maxExclusive}; widen the range`,
        );
      }
      const span = BigInt(maxExclusive - minInclusive);
      const draw = xoshiroNext(state) >> U64_TOP_BITS_FOR_INT;
      return minInclusive + Number(draw % span);
    },
  };
}
