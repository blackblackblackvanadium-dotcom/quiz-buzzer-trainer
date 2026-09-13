import Dexie, { type Table, type Transaction } from 'dexie';
import type { AppSetting, Attempt, QuestionRevision, QuizSession, StudyState } from '../domain/types';
import { questionKey } from '../domain/types';
import {
  isCanonicalQuestionRecord,
  migrateLegacyQuestionRecord,
  migratePreConformanceQuestionRecord,
  type LegacyQuestionRecordV1,
} from './questionMigration';

export const DB_SCHEMA_VERSION = 4;

export interface QuestionRecord extends QuestionRevision {
  readonly key: string;
}

const DB_V1_STORES = {
  questions: '&key, questionId, revisionId, category, pattern, difficulty, *tags',
  attempts: '&attemptId, [questionId+revisionId], questionId, revisionId, sessionId, mode, outcome, completedAt',
  studyStates: '[questionId+revisionId], questionId, revisionId, dueAt',
  sessions: '&sessionId, mode, startedAt, endedAt',
  settings: '&key',
} as const;

const DB_V2_STORES = {
  questions: '&key, questionId, revisionId, revision, classification.genre.primary, metadata.status',
  attempts: '&attemptId, [questionId+revisionId], questionId, revisionId, sessionId, mode, outcome, completedAt',
  studyStates: '[questionId+revisionId], questionId, revisionId, dueAt',
  sessions: '&sessionId, mode, startedAt, endedAt',
  settings: '&key',
} as const;

// v3 changes DATA conformance, not identity: revisionId remains scoped by questionId.
const DB_V3_STORES = DB_V2_STORES;
// v4 extends Attempt/Session payloads only; existing indexes stay stable for backward compatibility.
const DB_V4_STORES = DB_V3_STORES;

export class QbtDatabase extends Dexie {
  questions!: Table<QuestionRecord, string>;
  attempts!: Table<Attempt, string>;
  studyStates!: Table<StudyState, [string, string]>;
  sessions!: Table<QuizSession, string>;
  settings!: Table<AppSetting, string>;

  constructor(name = 'qbt-phase1') {
    super(name);

    this.version(1).stores(DB_V1_STORES);
    this.version(2)
      .stores(DB_V2_STORES)
      .upgrade(async (transaction) => {
        const questionsTable = transaction.table('questions');
        await questionsTable.toCollection().modify((record: Record<string, unknown>) => {
          const { key: _storedKey, ...payload } = record;
          const migrated = isCanonicalQuestionRecord(payload)
            ? migratePreConformanceQuestionRecord(payload, extractVerificationTime(payload))
            : migrateLegacyQuestionRecord(record as unknown as LegacyQuestionRecordV1);
          replaceStoredQuestion(record, migrated);
        });
        await verifyQuestionTable(transaction);
      });

    // Required because main had already shipped DB v2 before the final QBT-02 conformance pass.
    this.version(3)
      .stores(DB_V3_STORES)
      .upgrade(async (transaction) => {
        const questionsTable = transaction.table('questions');
        await questionsTable.toCollection().modify((record: Record<string, unknown>) => {
          const { key: _storedKey, ...payload } = record;
          const migrated = migratePreConformanceQuestionRecord(payload, extractVerificationTime(payload));
          replaceStoredQuestion(record, migrated);
        });
        await verifyQuestionTable(transaction);
      });

    this.version(DB_SCHEMA_VERSION)
      .stores(DB_V4_STORES)
      .upgrade(async (transaction) => {
        await transaction.table('attempts').toCollection().modify((record: Record<string, unknown>) => {
          if (record.isCorrect === undefined) record.isCorrect = correctnessFromOutcome(record.outcome);
          if (record.startedAtEpochMs === undefined) record.startedAtEpochMs = epochFromUnknown(record.startedAt);
          if (record.completedAtEpochMs === undefined) record.completedAtEpochMs = epochFromUnknown(record.completedAt);
          if (record.totalGraphemeCount === undefined) record.totalGraphemeCount = null;
          if (record.kimari === undefined) record.kimari = null;
        });
        await transaction.table('sessions').toCollection().modify((record: Record<string, unknown>) => {
          if (record.startedAtEpochMs === undefined) record.startedAtEpochMs = epochFromUnknown(record.startedAt);
          if (record.endedAtEpochMs === undefined) {
            record.endedAtEpochMs = record.endedAt === null || record.endedAt === undefined
              ? null
              : epochFromUnknown(record.endedAt);
          }
          if (record.endReason === undefined) record.endReason = null;
          if (record.targetQuestionCount === undefined) record.targetQuestionCount = 0;
          if (record.consumedQuestionCount === undefined) record.consumedQuestionCount = 0;
          if (record.modeResult === undefined) record.modeResult = null;
        });
      });
  }
}

function correctnessFromOutcome(value: unknown): boolean | null {
  if (value === 'correct') return true;
  if (value === 'incorrect') return false;
  return null;
}

function epochFromUnknown(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function replaceStoredQuestion(record: Record<string, unknown>, question: QuestionRevision): void {
  const stored = toQuestionRecord(question);
  for (const existingKey of Object.keys(record)) delete record[existingKey];
  Object.assign(record, stored);
}

async function verifyQuestionTable(transaction: Transaction): Promise<void> {
  const records = await transaction.table('questions').toArray() as QuestionRecord[];
  const numericRevisions = new Set<string>();

  for (const record of records) {
    const expectedKey = questionKey(record);
    if (record.key !== expectedKey) throw new Error(`Migrated Question key mismatch: expected ${expectedKey}`);

    const numericKey = `${record.questionId}::revision:${record.revision}`;
    if (numericRevisions.has(numericKey)) {
      throw new Error(`Migrated Question numeric revision collision: ${numericKey}`);
    }
    numericRevisions.add(numericKey);
  }
}

function extractVerificationTime(value: Record<string, unknown>): string {
  const metadata = value.metadata;
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
    const updatedAt = (metadata as Record<string, unknown>).updatedAt;
    if (typeof updatedAt === 'string' && Number.isFinite(Date.parse(updatedAt))) return updatedAt;
  }
  return '1970-01-01T00:00:00.000Z';
}

export const db = new QbtDatabase();

export function toQuestionRecord(question: QuestionRevision): QuestionRecord {
  return { ...question, key: questionKey(question) };
}
