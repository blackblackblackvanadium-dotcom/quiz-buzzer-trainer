import { QUESTION_SCHEMA_VERSION, type QuestionRecordV1 } from '../domain/types';

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

const MIGRATION_METHOD = 'legacy_db_v1_migration';
const MIGRATION_VERSION = 'question-schema-v1-db-migration-1';

function countGraphemes(text: string): number {
  return Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)).length;
}

function revisionNumber(revisionId: string): number {
  const match = /^r(\d+)$/iu.exec(revisionId.trim());
  if (match === null) return 1;
  const parsed = Number.parseInt(match[1] ?? '1', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function safeIsoDate(value: string): string {
  return Number.isFinite(Date.parse(value)) ? value : '1970-01-01T00:00:00.000Z';
}

function derivedTextKey(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\s\p{Z}\p{P}]+/gu, '');
}

export function isCanonicalQuestionRecord(value: unknown): value is QuestionRecordV1 {
  return typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === QUESTION_SCHEMA_VERSION;
}

export function migrateLegacyQuestionRecord(value: LegacyQuestionRecordV1): QuestionRecordV1 {
  const graphemeCount = countGraphemes(value.prompt);
  const createdAt = safeIsoDate(value.createdAt);
  const provenance = {
    method: MIGRATION_METHOD,
    generator: 'quiz-buzzer-trainer',
    generatorVersion: MIGRATION_VERSION,
    note: 'Migrated from DB schema v1 legacy Question record.',
  } as const;

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
    point !== null && point.requiredPrefixGraphemes >= 1 && point.requiredPrefixGraphemes <= graphemeCount,
  );

  return {
    schemaVersion: QUESTION_SCHEMA_VERSION,
    questionId: value.questionId,
    revisionId: value.revisionId,
    revision: revisionNumber(value.revisionId),
    prompt: value.prompt,
    answers: {
      primaryAnswer: {
        id: 'primary',
        text: value.canonicalAnswer,
        provenance,
      },
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
        ? {
            code: value.pattern,
            taxonomyVersion: 'legacy-v1',
            provenance,
          }
        : undefined,
      tags: value.tags.map((id) => ({ id })),
      difficulty: Number.isFinite(value.difficulty)
        ? {
            value: value.difficulty,
            scale: 'legacy-v1',
            provenance,
          }
        : undefined,
    },
    determiningPoints,
    sources: [],
    derived: {
      graphemeCount,
      graphemeProfile: 'Intl.Segmenter:ja:grapheme',
      exactTextHash: `legacy-migration:${value.questionId}:${value.revisionId}`,
      duplicateDetectionKey: derivedTextKey(value.prompt),
      computedAt: createdAt,
      generatorVersion: MIGRATION_VERSION,
    },
    quality: {
      status: 'warning',
      issues: [{
        code: 'legacy_db_v1_migrated',
        severity: 'warning',
        message: 'Question was migrated from the legacy DB v1 shape and should be revalidated against authoritative data.',
      }],
      lastCheckedAt: createdAt,
      qualityProfileVersion: 'schema-v1-migration',
    },
    metadata: {
      createdAt,
      updatedAt: createdAt,
      status: 'active',
    },
  };
}
