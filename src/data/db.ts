import Dexie, { type Table } from 'dexie';
import type { AppSetting, Attempt, QuestionRevision, QuizSession, StudyState } from '../domain/types';
import { questionKey } from '../domain/types';

export const DB_SCHEMA_VERSION = 1;

export interface QuestionRecord extends QuestionRevision {
  readonly key: string;
}

export class QbtDatabase extends Dexie {
  questions!: Table<QuestionRecord, string>;
  attempts!: Table<Attempt, string>;
  studyStates!: Table<StudyState, [string, string]>;
  sessions!: Table<QuizSession, string>;
  settings!: Table<AppSetting, string>;

  constructor(name = 'qbt-phase1') {
    super(name);
    this.version(DB_SCHEMA_VERSION).stores({
      questions: '&key, questionId, revisionId, category, pattern, difficulty, *tags',
      attempts: '&attemptId, [questionId+revisionId], questionId, revisionId, sessionId, mode, outcome, completedAt',
      studyStates: '[questionId+revisionId], questionId, revisionId, dueAt',
      sessions: '&sessionId, mode, startedAt, endedAt',
      settings: '&key',
    });
  }
}

export const db = new QbtDatabase();

export function toQuestionRecord(question: QuestionRevision): QuestionRecord {
  return { ...question, key: questionKey(question) };
}
