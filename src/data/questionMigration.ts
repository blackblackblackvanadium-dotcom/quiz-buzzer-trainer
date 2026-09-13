import {
  QUESTION_SCHEMA_VERSION,
  QUALITY_PROFILE_VERSION,
  type ProvenanceMethod,
  type QuestionRecordV1,
} from '../domain/types';
import { computeDerivedQuestionData } from './questionIntegrity';
import { parseQuestionRecordV1, prepareQuestionRecordV1 } from './validation';

export interface LegacyQuestionRecordV1 {
  readonly key?: string;
  readonly questionId: string;
  readonly revisionId: string;
  readonly prompt: string;
  readonly canonicalAnswer: string;
  readonly acceptableAnswers: readonly string[];
  readonly rejectedAnswers: readonly string[];
  readonly category: string;
  readonly pattern: string;
  readonly difficulty: number;
  readonly tags: readonly string[];
  readonly idealBuzzIndex?: number;
  readonly advancedBuzzIndex?: number;
  readonly createdAt: string;
}

const MIGRATION_VERSION = 'question-schema-v1-db-migration-3';
const CANONICAL_PROVENANCE_METHODS = new Set<ProvenanceMethod>([
  'human_verified', 'human_unverified', 'imported', 'computed', 'rule_inferred', 'ai_inferred', 'unknown',
]);

function revisionNumber(revisionId: string): number {
  const match = /^r(\d+)$/iu.exec(revisionId.trim());
  if (match === null) return 1;
  const parsed = Number.parseInt(match[1] ?? '1', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function safeIsoDate(value: string): string {
  return Number.isFinite(Date.parse(value)) ? value : '1970-01-01T00:00:00.000Z';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeProvenanceMethod(value: unknown): ProvenanceMethod {
  if (CANONICAL_PROVENANCE_METHODS.has(value as ProvenanceMethod)) return value as ProvenanceMethod;
  if (value === 'seed') return 'human_unverified';
  if (value === 'legacy_db_v1_migration') return 'imported';
  return 'unknown';
}

function normalizeProvenance(value: unknown): void {
  if (!isRecord(value)) return;
  value.method = normalizeProvenanceMethod(value.method);
}

/**
 * Upgrades records written by the first Schema-v1 implementation before the
 * final QBT-02 conformance pass. It normalizes provenance methods and required
 * quality metadata, then runs the canonical derived/quality preparation step.
 */
export function migratePreConformanceQuestionRecord(value: unknown, checkedAt: string): QuestionRecordV1 {
  if (!isRecord(value)) throw new Error('Pre-conformance Question must be an object');
  const clone = JSON.parse(JSON.stringify(value)) as unknown;
  if (!isRecord(clone)) throw new Error('Pre-conformance Question must be serializable as an object');

  const answers = clone.answers;
  if (isRecord(answers)) {
    const primary = answers.primaryAnswer;
    if (isRecord(primary)) normalizeProvenance(primary.provenance);
    for (const item of Array.isArray(answers.acceptedAnswers) ? answers.acceptedAnswers : []) {
      if (isRecord(item)) normalizeProvenance(item.provenance);
    }
    for (const item of Array.isArray(answers.rejectedAnswers) ? answers.rejectedAnswers : []) {
      if (isRecord(item)) normalizeProvenance(item.provenance);
    }
  }

  const classification = clone.classification;
  if (isRecord(classification)) {
    if (isRecord(classification.genre)) normalizeProvenance(classification.genre.provenance);
    if (isRecord(classification.questionType)) normalizeProvenance(classification.questionType.provenance);
    if (isRecord(classification.difficulty)) normalizeProvenance(classification.difficulty.provenance);
  }

  for (const point of Array.isArray(clone.determiningPoints) ? clone.determiningPoints : []) {
    if (isRecord(point)) normalizeProvenance(point.provenance);
  }

  if (isRecord(clone.quality) && clone.quality.qualityProfileVersion === undefined) {
    clone.quality.qualityProfileVersion = QUALITY_PROFILE_VERSION;
  }

  return prepareQuestionRecordV1(clone, checkedAt);
}

export function isCanonicalQuestionRecord(value: unknown): value is QuestionRecordV1 {
  return typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === QUESTION_SCHEMA_VERSION;
}

export function migrateLegacyQuestionRecord(value: LegacyQuestionRecordV1): QuestionRecordV1 {
  const createdAt = safeIsoDate(value.createdAt);
  const provenance = {
    method: 'imported' as const,
    generator: 'quiz-buzzer-trainer',
    generatorVersion: MIGRATION_VERSION,
    note: 'Migrated from DB schema v1 legacy Question record.',
  };

  const derived = computeDerivedQuestionData(value.prompt, createdAt);
  const determiningPoints = [
    value.advancedBuzzIndex === undefined
      ? null
      : {
          id: 'legacy-advanced',
          method: 'rule_estimated' as const,
          requiredPrefixGraphemes: value.advancedBuzzIndex,
          provenance,
          note: 'Migrated from advancedBuzzIndex.',
        },
    value.idealBuzzIndex === undefined
      ? null
      : {
          id: 'legacy-ideal',
          method: 'rule_estimated' as const,
          requiredPrefixGraphemes: value.idealBuzzIndex,
          provenance,
          note: 'Migrated from idealBuzzIndex.',
        },
  ].filter((point): point is NonNullable<typeof point> =>
    point !== null && point.requiredPrefixGraphemes >= 1 && point.requiredPrefixGraphemes <= derived.graphemeCount,
  );

  const migrated: QuestionRecordV1 = {
    schemaVersion: QUESTION_SCHEMA_VERSION,
    questionId: value.questionId,
    revisionId: value.revisionId,
    revision: revisionNumber(value.revisionId),
    prompt: value.prompt,
    answers: {
      primaryAnswer: { id: 'primary', text: value.canonicalAnswer, provenance },
      acceptedAnswers: value.acceptableAnswers.map((text, index) => ({
        id: `accepted-${index + 1}`,
        text,
        relation: 'other' as const,
        provenance,
      })),
      rejectedAnswers: value.rejectedAnswers.map((text, index) => ({
        id: `rejected-${index + 1}`,
        text,
        rejectionReason: 'other' as const,
        provenance,
      })),
    },
    classification: {
      genre: {
        primary: value.category || 'uncategorized',
        taxonomyVersion: 'legacy-v1',
        provenance,
      },
      questionType: value.pattern
        ? { code: value.pattern, taxonomyVersion: 'legacy-v1', provenance }
        : undefined,
      tags: value.tags.map((id) => ({ id })),
      difficulty: Number.isFinite(value.difficulty)
        ? { value: value.difficulty, scale: 'legacy-v1', provenance }
        : undefined,
    },
    determiningPoints,
    sources: [],
    derived,
    quality: {
      status: 'warning',
      issues: [{
        code: 'legacy_db_v1_migrated',
        severity: 'warning',
        message: 'Question was migrated from the legacy DB v1 shape and should be revalidated against authoritative data.',
      }],
      lastCheckedAt: createdAt,
      qualityProfileVersion: QUALITY_PROFILE_VERSION,
    },
    metadata: {
      createdAt,
      updatedAt: createdAt,
      status: 'active',
    },
  };

  return parseQuestionRecordV1(migrated);
}
