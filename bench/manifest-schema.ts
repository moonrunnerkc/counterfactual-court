import { z } from 'zod';

/** Categories of patches in the bench corpus, per the Dec 2025 CodeRabbit report. */
export const PatchCategory = z.enum([
  'real-merged',
  'logic-error',
  'security-vulnerability',
  'test-weakening',
  'prompt-injection',
  'license-laundering',
]);

/** TS view of {@link PatchCategory}. */
export type PatchCategory = z.infer<typeof PatchCategory>;

/** Verdict the bench expects each patch to receive. */
export const ExpectedVerdict = z.enum(['approve', 'reject', 'request-changes']);

/** TS view of {@link ExpectedVerdict}. */
export type ExpectedVerdict = z.infer<typeof ExpectedVerdict>;

/** Permissive licenses the bench accepts. Anything outside this set is excluded. */
export const PermissiveLicense = z.enum([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
]);

/** TS view of {@link PermissiveLicense}. */
export type PermissiveLicense = z.infer<typeof PermissiveLicense>;

/** One row in `bench/manifest.json`. */
export const ManifestEntry = z.object({
  /** Unique stable id; for real PRs `<owner>-<repo>-pr<number>`, for poisoned `<category>-<index>-<sourceId>`. */
  id: z.string().min(1),
  /** Bench-relative path to the patch file (e.g. `real/microsoft-typescript-pr12345.patch`). */
  patchPath: z.string().min(1),
  /** Category of the patch. */
  category: PatchCategory,
  /** What verdict the bench expects: real PRs approve; poisoned PRs reject. */
  expectedVerdict: ExpectedVerdict,
  /** SPDX license identifier of the source repo. */
  license: PermissiveLicense,
  /** Source attribution. For real PRs the upstream URL; for poisoned the source patch id and a one-line description. */
  source: z.object({
    kind: z.enum(['real-pr', 'poisoned-from']),
    /** GitHub URL for `kind=real-pr`; source patch id for `kind=poisoned-from`. */
    reference: z.string().min(1),
    description: z.string().min(1),
  }),
  /** SHA-256 of the patch file contents; pinned so a corrupted file fails manifest validation. */
  patchHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Total non-empty added lines; coarse size signal. */
  linesAdded: z.number().int().nonnegative(),
});

/** TS view of {@link ManifestEntry}. */
export type ManifestEntry = z.infer<typeof ManifestEntry>;

/** Top-level manifest. */
export const Manifest = z.object({
  schemaVersion: z.literal('1'),
  generatedAt: z.string().min(1),
  entries: z.array(ManifestEntry),
});

/** TS view of {@link Manifest}. */
export type Manifest = z.infer<typeof Manifest>;
