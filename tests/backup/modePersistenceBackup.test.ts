import { afterEach, describe, expect, it } from 'vitest';
import { createBackup, parseBackupJson, serializeBackup } from '../../src/backup/backup';
import { QbtDatabase } from '../../src/data/db';
import { createAttempt } from '../../src/engine/attemptFactory';
import { createSessionRecord, endSessionRecord } from '../../src/engine/sessionFactory';
import { makeQuestionV1 } from '../fixtures/questionV1';

const databases: QbtDatabase[] = [];

function createDatabase(name: string): QbtDatabase {
  const database = new QbtDatabase(name);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe('P0 #4 backup persistence contract', () => {
  it('round-trips Kimari Attempt metrics and Survival Session result', async () => {
    const database = createDatabase('qbt-backup-mode-fields');
    const question = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1, prompt: 'abcdefghij' });
    const attempt = createAttempt({
      attemptId: 'a1',
      question,
      sessionId: 's-k',
      mode: 'kimari',
      outcome: 'correct',
      judge: { kind: 'canonical', isCorrect: true, normalizedSubmitted: 'answer', matchedAnswer: 'Answer' },
      submittedAnswer: 'Answer',
      startedAt: '2026-09-14T00:00:01.000Z',
      completedAt: '2026-09-14T00:00:02.000Z',
      buzz: { buzzIndex: 4, totalGraphemeCount: 10, buzzRatio: 0.4, visibleText: 'abcd', buzzTimeMs: 200, buzzAtMs: 200 },
      responseTimeMs: 350,
      kimariReference: { questionId: 'q', revisionId: 'r1', referenceBuzzIndex: 3 },
    });
    const survivalStart = createSessionRecord({
      sessionId: 's-survival',
      mode: 'survival',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 5,
      modeResult: { mode: 'survival', score: 0, cleared: false, failure: null },
    });
    const survivalEnd = endSessionRecord(
      survivalStart,
      'survival_failed',
      '2026-09-14T00:00:03.000Z',
      {
        consumedQuestionCount: 3,
        modeResult: { mode: 'survival', score: 2, cleared: false, failure: { failedAttemptId: 'a-fail', cause: 'incorrect' } },
      },
    );
    await database.attempts.add(attempt);
    await database.sessions.add(survivalEnd);

    const parsed = parseBackupJson(serializeBackup(await createBackup(database)));
    expect(parsed.data.attempts[0]).toMatchObject({
      isCorrect: true,
      totalGraphemeCount: 10,
      kimari: { referenceBuzzIndex: 3, playerBuzzIndex: 4, deltaGraphemes: 1 },
    });
    expect(parsed.data.sessions[0]).toMatchObject({
      endReason: 'survival_failed',
      targetQuestionCount: 5,
      consumedQuestionCount: 3,
      modeResult: { mode: 'survival', score: 2, cleared: false, failure: { failedAttemptId: 'a-fail', cause: 'incorrect' } },
    });
  });

  it('normalizes a pre-P0 #4 legacy backup instead of dropping history', () => {
    const legacy = {
      format: 'qbt-backup',
      version: 1,
      exportedAt: '2026-09-14T00:00:00.000Z',
      appVersion: '0.1.0',
      dbSchemaVersion: 3,
      questionDataVersion: 'seed-v1',
      data: {
        questions: [],
        attempts: [{
          attemptId: 'legacy-a', questionId: 'q', revisionId: 'r1', sessionId: 'legacy-s', mode: 'normal', outcome: 'correct',
          judgeKind: 'canonical', submittedAnswer: 'Answer', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z',
          buzzIndex: 2, buzzRatio: 0.5, buzzTimeMs: 100, responseTimeMs: 200, visibleTextAtBuzz: 'ab',
        }],
        studyStates: [],
        sessions: [{ sessionId: 'legacy-s', mode: 'normal', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z' }],
        settings: [],
      },
    };

    const parsed = parseBackupJson(JSON.stringify(legacy));
    expect(parsed.data.attempts[0]).toMatchObject({
      attemptId: 'legacy-a', isCorrect: true, totalGraphemeCount: null, kimari: null,
      startedAtEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
    });
    expect(parsed.data.sessions[0]).toMatchObject({
      sessionId: 'legacy-s', endReason: null, targetQuestionCount: 0, consumedQuestionCount: 0, modeResult: null,
    });
  });

  it('rejects an invalid Kimari delta invariant', () => {
    const invalid = {
      format: 'qbt-backup', version: 1, exportedAt: '2026-09-14T00:00:00.000Z', appVersion: '0.1.0', dbSchemaVersion: 4,
      questionDataVersion: 'seed-v1',
      data: {
        questions: [],
        attempts: [{
          attemptId: 'a', questionId: 'q', revisionId: 'r1', sessionId: 's', mode: 'kimari', outcome: 'correct', isCorrect: true,
          startedAtEpochMs: 1, completedAtEpochMs: 2, judgeKind: 'canonical', submittedAnswer: 'Answer',
          startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', buzzIndex: 4, totalGraphemeCount: 10,
          buzzRatio: 0.4, buzzTimeMs: 100, responseTimeMs: 200, visibleTextAtBuzz: 'abcd',
          kimari: { referenceBuzzIndex: 3, playerBuzzIndex: 4, deltaGraphemes: 99 },
        }],
        studyStates: [], sessions: [], settings: [],
      },
    };
    expect(() => parseBackupJson(JSON.stringify(invalid))).toThrow('deltaGraphemes invariant');
  });
});
