import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { StudyState } from '../../src/domain/types';
import { DB_SCHEMA_VERSION, QbtDatabase } from '../../src/data/db';
import type { LegacyQuestionRecordV1 } from '../../src/data/questionMigration';

interface LegacyStoredQuestion extends LegacyQuestionRecordV1 {
  readonly key: string;
}

interface LegacyAttemptRecord {
  readonly attemptId: string;
  readonly questionId: string;
  readonly revisionId: string;
  readonly sessionId: string;
  readonly mode: string;
  readonly outcome: string;
  readonly judgeKind: string | null;
  readonly submittedAnswer: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly buzzIndex: number | null;
  readonly buzzRatio: number | null;
  readonly buzzTimeMs: number | null;
  readonly responseTimeMs: number | null;
  readonly visibleTextAtBuzz: string | null;
}

interface LegacySessionRecord {
  readonly sessionId: string;
  readonly mode: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

class LegacyDatabase extends Dexie {
  questions!: Table<LegacyStoredQuestion, string>;
  attempts!: Table<LegacyAttemptRecord, string>;
  studyStates!: Table<StudyState, [string, string]>;
  sessions!: Table<LegacySessionRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      questions: '&key, questionId, revisionId, category, pattern, difficulty, *tags',
      attempts: '&attemptId, [questionId+revisionId], questionId, revisionId, sessionId, mode, outcome, completedAt',
      studyStates: '[questionId+revisionId], questionId, revisionId, dueAt',
      sessions: '&sessionId, mode, startedAt, endedAt',
      settings: '&key',
    });
  }
}

const databaseNames: string[] = [];

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

function question(canonicalAnswer = 'Answer'): LegacyStoredQuestion {
  return {
    key: 'q::r1',
    questionId: 'q',
    revisionId: 'r1',
    prompt: 'abcd',
    canonicalAnswer,
    acceptableAnswers: ['Alias'],
    rejectedAnswers: ['Wrong'],
    category: 'general',
    pattern: 'fact',
    difficulty: 1,
    tags: ['tag-1'],
    advancedBuzzIndex: 1,
    idealBuzzIndex: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function attempt(): LegacyAttemptRecord {
  return {
    attemptId: 'attempt-1',
    questionId: 'q',
    revisionId: 'r1',
    sessionId: 'session-1',
    mode: 'normal',
    outcome: 'correct',
    judgeKind: 'canonical',
    submittedAnswer: 'Answer',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    buzzIndex: 1,
    buzzRatio: 0.25,
    buzzTimeMs: 100,
    responseTimeMs: 300,
    visibleTextAtBuzz: 'a',
  };
}

function session(): LegacySessionRecord {
  return {
    sessionId: 'session-1',
    mode: 'normal',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:02.000Z',
  };
}

function studyState(): StudyState {
  return {
    questionId: 'q',
    revisionId: 'r1',
    dueAt: '2026-01-02T00:00:00.000Z',
    intervalDays: 1,
    easeFactor: 2.5,
    repetitions: 1,
    lapses: 0,
    bestBuzzIndex: 1,
    bestBuzzRatio: 0.25,
    bestResponseTimeMs: 300,
    correctCount: 1,
    attemptCount: 1,
    streak: 1,
  };
}

async function seedLegacy(database: LegacyDatabase, canonicalAnswer = 'Answer'): Promise<void> {
  await database.open();
  await database.questions.add(question(canonicalAnswer));
  await database.attempts.add(attempt());
  await database.studyStates.add(studyState());
  await database.sessions.add(session());
}

describe('P0 #6 DB migration history preservation', () => {
  it('migrates v1 to the current schema without losing Question, Attempt, Session, or StudyState history', async () => {
    const name = 'qbt-p0-6-migration-all-history';
    databaseNames.push(name);
    const legacy = new LegacyDatabase(name);
    await seedLegacy(legacy);
    legacy.close();

    const upgraded = new QbtDatabase(name);
    await upgraded.open();

    expect(upgraded.verno).toBe(DB_SCHEMA_VERSION);
    expect(await upgraded.questions.get('q::r1')).toMatchObject({
      key: 'q::r1',
      questionId: 'q',
      revisionId: 'r1',
      prompt: 'abcd',
    });
    expect(await upgraded.attempts.get('attempt-1')).toEqual({
      ...attempt(),
      isCorrect: true,
      startedAtEpochMs: Date.parse(attempt().startedAt),
      completedAtEpochMs: Date.parse(attempt().completedAt),
      totalGraphemeCount: null,
      kimari: null,
    });
    expect(await upgraded.sessions.get('session-1')).toEqual({
      ...session(),
      startedAtEpochMs: Date.parse(session().startedAt),
      endedAtEpochMs: Date.parse(session().endedAt!),
      endReason: null,
      targetQuestionCount: 0,
      consumedQuestionCount: 0,
      modeResult: null,
    });
    expect(await upgraded.studyStates.get(['q', 'r1'])).toEqual(studyState());

    upgraded.close();
  });

  it('rolls a failed schema upgrade back and leaves every legacy history store intact', async () => {
    const name = 'qbt-p0-6-migration-rollback';
    databaseNames.push(name);
    const legacy = new LegacyDatabase(name);
    await seedLegacy(legacy, 'bad\u0001answer');
    legacy.close();

    const upgraded = new QbtDatabase(name);
    await expect(upgraded.open()).rejects.toThrow('forbidden control character');
    upgraded.close();

    const reopenedLegacy = new LegacyDatabase(name);
    await reopenedLegacy.open();
    expect(await reopenedLegacy.questions.get('q::r1')).toEqual(question('bad\u0001answer'));
    expect(await reopenedLegacy.attempts.get('attempt-1')).toEqual(attempt());
    expect(await reopenedLegacy.sessions.get('session-1')).toEqual(session());
    expect(await reopenedLegacy.studyStates.get(['q', 'r1'])).toEqual(studyState());
    reopenedLegacy.close();
  });
});
