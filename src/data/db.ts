import Dexie, { type Table } from 'dexie';
import type { AppSetting, Attempt, QuestionRevision, QuizSession, StudyState } from '../domain/types';
import { questionKey } from '../domain/types';
import { isCanonicalQuestionRecord, migrateLegacyQuestionRecord, type LegacyQuestionRecordV1 } from './questionMigration';

export const DB_SCHEMA_VERSION = 2;

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

export class QbtDatabase extends Dexie {
  questions!: Table<QuestionRecord, string>;
  attempts!: Table<Attempt, string>;
  studyStates!: Table<StudyState, [string, string]>;
  sessions!: Table<QuizSession, string>;
  settings!: Table<AppSetting, string>;

  constructor(name = 'qbt-phase1') {
    super(name);

    this.version(1).stores(DB_V1_STORES);
    this.version(DB_SCHEMA_VERSION)
      .stores(DB_V2_STORES)
      .upgrade(async (transaction) => {
        await transaction.table('questions').toCollection().modify((record: Record<string, unknown>) => {
          if (isCanonicalQuestionRecord(record)) return;
          const migrated = toQuestionRecord(migrateLegacyQuestionRecord(record as unknown as LegacyQuestionRecordV1));
          for (const key of Object.keys(record)) delete record[key];
          Object.assign(record, migrated);
        });
      });
  }
}

export const db = new QbtDatabase();

export function toQuestionRecord(question: QuestionRevision): QuestionRecord {
  return { ...question, key: questionKey(question) };
}
