/**
 * Public surface for the determinism primitives used everywhere in the agent
 * loop. This file is a barrel: implementations live in `rng.ts`, `clock.ts`,
 * and `canonical.ts`. Importing from `./determinism.js` is the single
 * approved way for runtime and agent code to obtain randomness, time, or
 * content hashing.
 */
export type { Rng, RngSeed } from './rng.js';
export { createRng } from './rng.js';

export type { Clock } from './clock.js';
export { frozenClockAt, wallClock } from './clock.js';

export { canonicalJson, contentHash, sha256Hex } from './canonical.js';
