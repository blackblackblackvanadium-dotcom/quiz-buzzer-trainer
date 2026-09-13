import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudyState } from '../../src/domain/types';
import { bumpDatabaseGeneration, getDatabaseGeneration } from '../../src/data/concurrency';
import { QbtDatabase } from '../../src/data/db';
import {
  SessionRepository,
  persistAttemptAndSessionTransaction,
} from '../../src/data/repositories';
import { createAttempt } from '../../src/engine/attemptFactory';
import { createSessionRecord, updateSessionProgress } from '../../src/engine/sessionFactory';
import { makeQuestionV1 } from '../fixtures/questionV1';

const databases: QbtDatabase[] = [];

function database(name: string): QbtDatabase {
  const value = new QbtDatabase(name);
  databases.push(value);
  return value;
}

function studyState(): StudyState {
  return {
    questionId: 'q1',
    revisionId: 'r1',
    dueAt: '2026-09-15T00:00:00.000Z',
    intervalDays: 1,
    easeFactor: 2.5,
    repetitions: 1,
    lapses: 0,
    bestBuzzIndex: 2,
    bestBuzzRatio: 0.5,
    bestResponseTimeMs: 300,
    correctCount: 1,
    attemptCount: 1,
    streak: 1,
  };
}

function attempt(sessionId = 's1') {
  const question = makeQuestionV1({ questionId: 'q1', revisionId: 'r1', revision: 1 });
  return createAttempt({
    attemptId: 'a1',
    question,
    sessionId,
    mode: 'review',
    outcome: 'correct',
    judge: { kind: 'canonical', isCorrect: true, normalizedSubmitted: 'answer', matchedAnswer: 'Answer' },
    submittedAnswer: 'Answer',
    startedAt: '2026-09-14T00:00:01.000Z',
    completedAt: '2026-09-14T00:00:02.000Z',
    buzz: {
      buzzIndex: 2,
      totalGraphemeCount: 4,
      buzzRatio: 0.5,
      visibleText: 'ab',
      buzzTimeMs: 200,
      buzzAtMs: 200,
    },
    responseTimeMs: 300,
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map(async (value) => {
    value.close();
    await value.delete();
  }));
});

describe('P0 #7 storage quota and multi-tab regression', () => {
  it('surfaces quota failure and rolls the entire Attempt + Session + StudyState transaction back', async () => {
    const db = database('qbt-p0-7-quota-rollback');
    const session = createSessionRecord({
      sessionId: 's1',
      mode: 'review',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 2,
    });
    await db.sessions.add(session);
    const resolved = attempt();
    const progressed = updateSessionProgress(session, 1, null);

    vi.spyOn(db.studyStates, 'put').mockImplementationOnce(() => {
      throw new DOMException('storage quota exhausted', 'QuotaExceededError');
    });

    await expect(
      persistAttemptAndSessionTransaction(resolved, progressed, studyState(), db),
    ).rejects.toMatchObject({ name: 'QuotaExceededError' });

    expect(await db.attempts.count()).toBe(0);
    expect(await db.studyStates.count()).toBe(0);
    expect(await db.sessions.get('s1')).toEqual(session);
  });

  it('rejects stale Session writes after another tab advances the database generation', async () => {
    const db = database('qbt-p0-7-stale-tab');
    const generation = getDatabaseGeneration();
    const repo = new SessionRepository(db);
    const session = createSessionRecord({
      sessionId: 's1',
      mode: 'normal',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 2,
    });
    await repo.put(session, generation);

    bumpDatabaseGeneration();
    const progressed = updateSessionProgress(session, 1, null);

    await expect(repo.put(progressed, generation)).rejects.toThrow(
      'Local database changed in another tab; reload before continuing this session',
    );
    expect(await db.sessions.get('s1')).toEqual(session);
  });

  it('rejects a stale atomic Attempt transaction without partial writes after generation changes', async () => {
    const db = database('qbt-p0-7-stale-atomic');
    const generation = getDatabaseGeneration();
    const session = createSessionRecord({
      sessionId: 's1',
      mode: 'review',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 2,
    });
    await db.sessions.add(session);
    const progressed = updateSessionProgress(session, 1, null);
    const resolved = attempt();

    bumpDatabaseGeneration();

    await expect(
      persistAttemptAndSessionTransaction(resolved, progressed, studyState(), db, generation),
    ).rejects.toThrow('Local database changed in another tab');
    expect(await db.attempts.count()).toBe(0);
    expect(await db.studyStates.count()).toBe(0);
    expect(await db.sessions.get('s1')).toEqual(session);
  });
});
