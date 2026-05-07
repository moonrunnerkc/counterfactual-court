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

/**
 * Discriminated zod schema for evidence-graph nodes. Mirrors the TS type union
 * in {@link ../evidence/graph.ts}; kept in sync because both must change
 * together when a new node kind is added.
 */
const NodeIdSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Source agent enum mirrored as a zod schema for runtime validation. */
export const ExhibitSourceSchema = z.enum(['prosecution', 'defense', 'reporter', 'jury']);
/** Edge-relation enum mirrored as a zod schema for runtime validation. */
export const EdgeRelationSchema = z.enum(['supports', 'refutes', 'depends-on']);

/** Zod schema for an exhibit-node payload (kind=exhibit). */
export const ExhibitNodePayloadSchema = z.object({
  source: ExhibitSourceSchema,
  label: z.string().min(1),
  claim: z.string().min(1),
  evidence: z.string().min(1),
  confidence: z.number().min(0).max(1),
  kind: ExhibitKind,
});

/** Zod schema for a citation-node payload (kind=citation). */
export const CitationNodePayloadSchema = z.object({
  reference: z.string().min(1),
  excerpt: z.string().min(1),
});

/** Zod schema for a test-case-node payload (kind=test-case). */
export const TestCaseNodePayloadSchema = z.object({
  description: z.string().min(1),
  expected: z.string().min(1),
  observed: z.string().nullable(),
});

/** Zod schema for a precedent-node payload (kind=precedent). */
export const PrecedentNodePayloadSchema = z.object({
  bundleId: z.string().min(1),
  similarity: z.number().min(0).max(1),
  justification: z.string().min(1),
});

/** Zod schema for the verdict-node payload (kind=verdict). */
export const VerdictNodePayloadSchema = z.object({
  verdict: Verdict,
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1),
});

/** Discriminated zod schema over the {@link EvidenceNode} union. */
export const EvidenceNodeSchema = z.discriminatedUnion('kind', [
  z.object({
    id: NodeIdSchema,
    kind: z.literal('exhibit'),
    payload: ExhibitNodePayloadSchema,
  }),
  z.object({
    id: NodeIdSchema,
    kind: z.literal('citation'),
    payload: CitationNodePayloadSchema,
  }),
  z.object({
    id: NodeIdSchema,
    kind: z.literal('test-case'),
    payload: TestCaseNodePayloadSchema,
  }),
  z.object({
    id: NodeIdSchema,
    kind: z.literal('precedent'),
    payload: PrecedentNodePayloadSchema,
  }),
  z.object({
    id: NodeIdSchema,
    kind: z.literal('verdict'),
    payload: VerdictNodePayloadSchema,
  }),
]);

/** Zod schema for one evidence-graph edge. */
export const EvidenceEdgeSchema = z.object({
  fromId: NodeIdSchema,
  toId: NodeIdSchema,
  relation: EdgeRelationSchema,
});

/** Zod schema for the full evidence graph. */
export const EvidenceGraphSchema = z.object({
  nodes: z.array(EvidenceNodeSchema),
  edges: z.array(EvidenceEdgeSchema),
  dissents: z.array(JuryDissent),
});

/**
 * Zod schema for the raw Jury output that the builder converts into a
 * content-addressed {@link EvidenceGraphSchema}. Labels are LLM-friendly
 * strings; the builder hashes payloads to produce stable ids.
 */
export const RawJuryGraphSchema = z.object({
  exhibits: z.array(ExhibitNodePayloadSchema),
  citations: z.array(CitationNodePayloadSchema.extend({ label: z.string().min(1) })),
  testCases: z.array(TestCaseNodePayloadSchema.extend({ label: z.string().min(1) })),
  precedents: z.array(PrecedentNodePayloadSchema.extend({ label: z.string().min(1) })),
  verdict: VerdictNodePayloadSchema.extend({ label: z.string().min(1) }),
  edges: z.array(
    z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      relation: EdgeRelationSchema,
    }),
  ),
  dissents: z.array(JuryDissent),
});

/** TS view of {@link RawJuryGraphSchema}. */
export type RawJuryGraphValidated = z.infer<typeof RawJuryGraphSchema>;

/** Final Jury output. The prose is generated from the cited evidence ids. */
export const JuryOpinion = z.object({
  verdict: Verdict,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  citedEvidenceIds: z.array(z.string().min(1)),
  dissents: z.array(JuryDissent),
  /**
   * Optional content-addressed evidence graph. Present when the
   * `features.evidenceGraph` flag is on. Absent on legacy bundles so the
   * Phase 1 regression gate replays bit-identical.
   */
  evidenceGraph: EvidenceGraphSchema.nullable().optional(),
});
/** TS view of {@link JuryOpinion}. */
export type JuryOpinion = z.infer<typeof JuryOpinion>;
