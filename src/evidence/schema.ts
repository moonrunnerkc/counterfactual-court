import { z } from 'zod';

/**
 * Categorical kinds shared across agent outputs. The Prosecutor and Court
 * Reporter both produce exhibits; both classify them with the same enum so
 * the Jury sees a single vocabulary at deliberation time.
 *
 * Phase 2 will widen this enum as the evidence graph gains node types; keep
 * additions append-only because bundles in the wild reference these strings.
 */
export const ExhibitKind = z.enum([
  'logic-error',
  'security-risk',
  'test-weakening',
  'style-violation',
  'license-concern',
  'documentation',
  'multimodal-extraction',
  'other',
]);

/** TS view of {@link ExhibitKind}. */
export type ExhibitKind = z.infer<typeof ExhibitKind>;

/** A single allegation produced by the Prosecutor. */
export const ProsecutionExhibit = z.object({
  id: z.string().min(1),
  kind: ExhibitKind,
  claim: z.string().min(1),
  evidence: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
/** TS view of {@link ProsecutionExhibit}. */
export type ProsecutionExhibit = z.infer<typeof ProsecutionExhibit>;

/** Container returned by the Prosecutor. Exhibits may be empty. */
export const ProsecutionDossier = z.object({
  exhibits: z.array(ProsecutionExhibit),
  summary: z.string(),
});
/** TS view of {@link ProsecutionDossier}. */
export type ProsecutionDossier = z.infer<typeof ProsecutionDossier>;

/** A single rebuttal produced by the Defender, keyed to a Prosecutor exhibit. */
export const DefenseRebuttal = z.object({
  exhibitId: z.string().min(1),
  rebuttal: z.string().min(1),
  refutes: z.boolean(),
  confidence: z.number().min(0).max(1),
});
/** TS view of {@link DefenseRebuttal}. */
export type DefenseRebuttal = z.infer<typeof DefenseRebuttal>;

/** Container returned by the Defender. */
export const DefenseDossier = z.object({
  rebuttals: z.array(DefenseRebuttal),
  summary: z.string(),
});
/** TS view of {@link DefenseDossier}. */
export type DefenseDossier = z.infer<typeof DefenseDossier>;

/** A single multimodal-extracted exhibit produced by the Court Reporter. */
export const ReporterExhibit = z.object({
  id: z.string().min(1),
  attachmentName: z.string().min(1),
  extractedText: z.string(),
  intentSummary: z.string().min(1),
  kind: ExhibitKind,
});
/** TS view of {@link ReporterExhibit}. */
export type ReporterExhibit = z.infer<typeof ReporterExhibit>;

/** Container returned by the Court Reporter. May be empty. */
export const ReporterExhibits = z.object({
  exhibits: z.array(ReporterExhibit),
});
/** TS view of {@link ReporterExhibits}. */
export type ReporterExhibits = z.infer<typeof ReporterExhibits>;

/** Verdict labels the Jury can return. */
export const Verdict = z.enum(['approve', 'reject', 'request-changes']);
/** TS view of {@link Verdict}. */
export type Verdict = z.infer<typeof Verdict>;

/** A dissenting opinion attached to a {@link JuryOpinion}. */
export const JuryDissent = z.object({
  verdict: Verdict,
  rationale: z.string().min(1),
});
/** TS view of {@link JuryDissent}. */
export type JuryDissent = z.infer<typeof JuryDissent>;

/** Final Jury output. The prose is generated from the cited evidence ids. */
export const JuryOpinion = z.object({
  verdict: Verdict,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  citedEvidenceIds: z.array(z.string().min(1)),
  dissents: z.array(JuryDissent),
});
/** TS view of {@link JuryOpinion}. */
export type JuryOpinion = z.infer<typeof JuryOpinion>;
