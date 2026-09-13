import { quizModes, type AppSetting, type Attempt, type QuestionRevision, type QuizSession, type StudyState } from '../domain/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}.${key} must be a non-empty string`);
  return value;
}

function nullableNumber(record: Record<string, unknown>, key: string, label: string): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}.${key} must be a finite number or null`);
  return value;
}

export function parseQuestionRevision(value: unknown): QuestionRevision {
  if (!isRecord(value)) throw new Error('Question must be an object');
  const requiredStrings = ['questionId', 'revisionId', 'prompt', 'canonicalAnswer', 'category', 'pattern', 'createdAt'] as const;
  for (const key of requiredStrings) requiredString(value, key, 'Question');
  if (!isStringArray(value.acceptableAnswers)) throw new Error('Question.acceptableAnswers must be string[]');
  if (!isStringArray(value.rejectedAnswers)) throw new Error('Question.rejectedAnswers must be string[]');
  if (!isStringArray(value.tags)) throw new Error('Question.tags must be string[]');
  if (typeof value.difficulty !== 'number' || !Number.isFinite(value.difficulty)) throw new Error('Question.difficulty must be a finite number');
  for (const key of ['idealBuzzIndex', 'advancedBuzzIndex'] as const) {
    const current = value[key];
    if (current !== undefined && (!Number.isInteger(current) || (current as number) < 0)) {
      throw new Error(`Question.${key} must be a non-negative integer when present`);
    }
  }
  return value as unknown as QuestionRevision;
}

function parseAttempt(value: unknown): Attempt {
  if (!isRecord(value)) throw new Error('Attempt must be an object');
  for (const key of ['attemptId', 'questionId', 'revisionId', 'sessionId', 'startedAt', 'completedAt'] as const) {
    requiredString(value, key, 'Attempt');
  }
  if (!quizModes.includes(value.mode as (typeof quizModes)[number])) throw new Error('Attempt.mode is invalid');
  if (!['correct', 'incorrect', 'pass', 'skip'].includes(String(value.outcome))) throw new Error('Attempt.outcome is invalid');
  if (!(value.judgeKind === null || ['canonical', 'acceptable', 'rejected', 'incorrect'].includes(String(value.judgeKind)))) {
    throw new Error('Attempt.judgeKind is invalid');
  }
  if (!(value.submittedAnswer === null || typeof value.submittedAnswer === 'string')) throw new Error('Attempt.submittedAnswer is invalid');
  for (const key of ['buzzIndex', 'buzzRatio', 'buzzTimeMs', 'responseTimeMs'] as const) nullableNumber(value, key, 'Attempt');
  if (!(value.visibleTextAtBuzz === null || typeof value.visibleTextAtBuzz === 'string')) throw new Error('Attempt.visibleTextAtBuzz is invalid');
  return value as unknown as Attempt;
}

function parseStudyState(value: unknown): StudyState {
  if (!isRecord(value)) throw new Error('StudyState must be an object');
  for (const key of ['questionId', 'revisionId', 'dueAt'] as const) requiredString(value, key, 'StudyState');
  for (const key of ['intervalDays', 'easeFactor', 'repetitions', 'lapses', 'correctCount', 'attemptCount', 'streak'] as const) {
    const current = value[key];
    if (typeof current !== 'number' || !Number.isFinite(current)) throw new Error(`StudyState.${key} must be finite number`);
  }
  for (const key of ['bestBuzzIndex', 'bestBuzzRatio', 'bestResponseTimeMs'] as const) nullableNumber(value, key, 'StudyState');
  return value as unknown as StudyState;
}

function parseSession(value: unknown): QuizSession {
  if (!isRecord(value)) throw new Error('Session must be an object');
  requiredString(value, 'sessionId', 'Session');
  requiredString(value, 'startedAt', 'Session');
  if (!quizModes.includes(value.mode as (typeof quizModes)[number])) throw new Error('Session.mode is invalid');
  if (!(value.endedAt === null || typeof value.endedAt === 'string')) throw new Error('Session.endedAt is invalid');
  return value as unknown as QuizSession;
}

function parseSetting(value: unknown): AppSetting {
  if (!isRecord(value)) throw new Error('Setting must be an object');
  requiredString(value, 'key', 'Setting');
  return { key: value.key as string, value: value.value };
}

export interface PortableBackupV1 {
  readonly format: 'qbt-backup';
  readonly version: 1;
  readonly exportedAt: string;
  readonly appVersion: string;
  readonly dbSchemaVersion: number;
  readonly questionDataVersion: string;
  readonly data: {
    readonly questions: readonly QuestionRevision[];
    readonly attempts: readonly Attempt[];
    readonly studyStates: readonly StudyState[];
    readonly sessions: readonly QuizSession[];
    readonly settings: readonly AppSetting[];
  };
}

export function parsePortableBackup(value: unknown): PortableBackupV1 {
  if (!isRecord(value) || value.format !== 'qbt-backup' || value.version !== 1) throw new Error('Unsupported backup format/version');
  requiredString(value, 'exportedAt', 'Backup');
  requiredString(value, 'appVersion', 'Backup');
  requiredString(value, 'questionDataVersion', 'Backup');
  if (!Number.isInteger(value.dbSchemaVersion) || (value.dbSchemaVersion as number) < 1) throw new Error('Backup.dbSchemaVersion is invalid');
  if (!isRecord(value.data)) throw new Error('Backup.data must be an object');
  for (const key of ['questions', 'attempts', 'studyStates', 'sessions', 'settings'] as const) {
    if (!Array.isArray(value.data[key])) throw new Error(`Backup.data.${key} must be an array`);
  }

  return {
    format: 'qbt-backup',
    version: 1,
    exportedAt: value.exportedAt as string,
    appVersion: value.appVersion as string,
    dbSchemaVersion: value.dbSchemaVersion as number,
    questionDataVersion: value.questionDataVersion as string,
    data: {
      questions: (value.data.questions as unknown[]).map(parseQuestionRevision),
      attempts: (value.data.attempts as unknown[]).map(parseAttempt),
      studyStates: (value.data.studyStates as unknown[]).map(parseStudyState),
      sessions: (value.data.sessions as unknown[]).map(parseSession),
      settings: (value.data.settings as unknown[]).map(parseSetting),
    },
  };
}
