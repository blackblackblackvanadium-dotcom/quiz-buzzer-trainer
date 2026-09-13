import type { AppSetting, Attempt, QuestionRevision, QuizSession, StudyState } from '../domain/types';
import { DB_SCHEMA_VERSION, db, type QbtDatabase, type QuestionRecord, toQuestionRecord } from '../data/db';
import type { PortableBackupV1 } from '../data/validation';
import { parseCompatiblePortableBackup } from './backupCodec';

export const APP_VERSION = '0.1.0';
export const QUESTION_DATA_VERSION = 'seed-v1';

export async function createBackup(database: QbtDatabase = db): Promise<PortableBackupV1> {
  const [questionRecords, attempts, studyStates, sessions, settings] = await Promise.all([
    database.questions.toArray(),
    database.attempts.toArray(),
    database.studyStates.toArray(),
    database.sessions.toArray(),
    database.settings.toArray(),
  ]);
  const questions: QuestionRevision[] = questionRecords.map(({ key: _key, ...question }: QuestionRecord) => question);
  return {
    format: 'qbt-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    dbSchemaVersion: DB_SCHEMA_VERSION,
    questionDataVersion: QUESTION_DATA_VERSION,
    data: { questions, attempts, studyStates, sessions, settings },
  };
}

export function serializeBackup(backup: PortableBackupV1): string {
  return JSON.stringify(backup, null, 2);
}

export function parseBackupJson(text: string): PortableBackupV1 {
  return parseCompatiblePortableBackup(JSON.parse(text) as unknown);
}

/** Replace Restore only. The compatible parser validates and normalizes before this mutation. */
export async function replaceRestore(
  backup: PortableBackupV1,
  database: QbtDatabase = db,
): Promise<void> {
  await database.transaction(
    'rw',
    database.questions,
    database.attempts,
    database.studyStates,
    database.sessions,
    database.settings,
    async () => {
      await Promise.all([
        database.questions.clear(),
        database.attempts.clear(),
        database.studyStates.clear(),
        database.sessions.clear(),
        database.settings.clear(),
      ]);
      await database.questions.bulkAdd(backup.data.questions.map(toQuestionRecord));
      await database.attempts.bulkAdd(backup.data.attempts as Attempt[]);
      await database.studyStates.bulkAdd(backup.data.studyStates as StudyState[]);
      await database.sessions.bulkAdd(backup.data.sessions as QuizSession[]);
      await database.settings.bulkAdd(backup.data.settings as AppSetting[]);
    },
  );
}
