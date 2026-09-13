import { afterEach, describe, expect, it } from 'vitest';
import { createAttempt } from '../../src/engine/attemptFactory';
import { createSessionRecord, updateSessionProgress } from '../../src/engine/sessionFactory';
import { QbtDatabase } from '../../src/data/db';
import { persistAttemptAndSessionTransaction } from '../../src/data/repositories';
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

describe('Attempt + Session persistence', () => {
  it('commits resolved Attempt and Session progress in one transaction', async () => {
    const database = createDatabase('qbt-mode-persist-success');
    const session = createSessionRecord({
      sessionId: 's1',
      mode: 'survival',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 2,
      modeResult: { mode: 'survival', score: 0, cleared: false, failure: null },
    });
    await database.sessions.add(session);
    const question = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    const attempt = createAttempt({
      attemptId: 'a1',
      question,
      sessionId: 's1',
      mode: 'survival',
      outcome: 'correct',
      judge: { kind: 'canonical', isCorrect: true, normalizedSubmitted: 'answer', matchedAnswer: 'Answer' },
      submittedAnswer: 'Answer',
      startedAt: '2026-09-14T00:00:01.000Z',
      completedAt: '2026-09-14T00:00:02.000Z',
      buzz: { buzzIndex: 2, totalGraphemeCount: 4, buzzRatio: 0.5, visibleText: 'ab', buzzTimeMs: 200, buzzAtMs: 200 },
      responseTimeMs: 300,
    });
    const progressed = updateSessionProgress(session, 1, { mode: 'survival', score: 1, cleared: false, failure: null });

    await persistAttemptAndSessionTransaction(attempt, progressed, null, database);

    expect(await database.attempts.get('a1')).toMatchObject({
      isCorrect: true,
      totalGraphemeCount: 4,
      kimari: null,
    });
    expect(await database.sessions.get('s1')).toMatchObject({
      consumedQuestionCount: 1,
      modeResult: { mode: 'survival', score: 1, cleared: false, failure: null },
    });
  });

  it('rolls Session update back when Attempt insert fails', async () => {
    const database = createDatabase('qbt-mode-persist-rollback');
    const session = createSessionRecord({
      sessionId: 's1',
      mode: 'survival',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 2,
      modeResult: { mode: 'survival', score: 0, cleared: false, failure: null },
    });
    await database.sessions.add(session);
    const question = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    const attempt = createAttempt({
      attemptId: 'duplicate',
      question,
      sessionId: 's1',
      mode: 'survival',
      outcome: 'correct',
      judge: { kind: 'canonical', isCorrect: true, normalizedSubmitted: 'answer', matchedAnswer: 'Answer' },
      submittedAnswer: 'Answer',
      startedAt: '2026-09-14T00:00:01.000Z',
      completedAt: '2026-09-14T00:00:02.000Z',
      buzz: { buzzIndex: 2, totalGraphemeCount: 4, buzzRatio: 0.5, visibleText: 'ab', buzzTimeMs: 200, buzzAtMs: 200 },
      responseTimeMs: 300,
    });
    await database.attempts.add(attempt);
    const progressed = updateSessionProgress(session, 1, { mode: 'survival', score: 1, cleared: false, failure: null });

    await expect(persistAttemptAndSessionTransaction(attempt, progressed, null, database)).rejects.toThrow();
    expect(await database.attempts.count()).toBe(1);
    expect(await database.sessions.get('s1')).toMatchObject({ consumedQuestionCount: 0 });
  });
});
