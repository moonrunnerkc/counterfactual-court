import { z } from 'zod';
import {
  DefenseDossier,
  JuryOpinion,
  ProsecutionDossier,
  ReporterExhibits,
} from '../evidence/schema.js';
import { RuntimeLock } from './runtime-lock.js';

/** Per-LLM-call audit trail kept inside an agent record. */
export const BundleLlmCall = z.object({
  model: z.string().min(1),
  modelDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  promptHash: z.string().regex(/^[0-9a-f]{64}$/),
  responseHash: z.string().regex(/^[0-9a-f]{64}$/),
  seed: z.number().int().nonnegative(),
  prompt: z.string(),
  system: z.string(),
  response: z.string(),
  temperature: z.number(),
  topP: z.number(),
  topK: z.number().int().nonnegative(),
});

/** TS view of {@link BundleLlmCall}. */
export type BundleLlmCall = z.infer<typeof BundleLlmCall>;

/** Prosecutor record. */
export const BundleProsecutorAgent = z.object({
  call: BundleLlmCall,
  output: ProsecutionDossier,
});

/** Defender record. */
export const BundleDefenderAgent = z.object({
  call: BundleLlmCall,
  output: DefenseDossier,
});

/** Court Reporter record. May have no call when attachments are empty. */
export const BundleCourtReporterAgent = z.object({
  call: BundleLlmCall.nullable(),
  output: ReporterExhibits,
});

/** Jury record. */
export const BundleJuryAgent = z.object({
  call: BundleLlmCall,
  output: JuryOpinion,
});

/** Body of a verdict bundle prior to signing. The signature covers this. */
export const BundleBody = z.object({
  schemaVersion: z.literal('1'),
  id: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().min(1),
  fixture: z.string().min(1),
  baseSeed: z.string().min(1),
  runtime: RuntimeLock,
  inputs: z.object({
    patch: z.string(),
    repoSnippet: z.string(),
    repoHead: z.string(),
    styleDocs: z.string(),
    attachments: z.array(z.object({ name: z.string().min(1), base64: z.string().min(1) })),
  }),
  agents: z.object({
    prosecutor: BundleProsecutorAgent,
    defender: BundleDefenderAgent,
    courtReporter: BundleCourtReporterAgent,
    jury: BundleJuryAgent,
  }),
  replayInstructions: z.string(),
});

/** TS view of {@link BundleBody}. */
export type BundleBody = z.infer<typeof BundleBody>;

/** Signed bundle envelope: body plus an Ed25519 signature over its canonical JSON. */
export const SignedBundle = z.object({
  body: BundleBody,
  signature: z.object({
    alg: z.literal('Ed25519'),
    publicKeyB64: z.string().min(1),
    valueB64: z.string().min(1),
  }),
});

/** TS view of {@link SignedBundle}. */
export type SignedBundle = z.infer<typeof SignedBundle>;
