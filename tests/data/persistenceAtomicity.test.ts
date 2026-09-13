import { afterEach, describe, expect, it } from 'vitest';
import type { StudyState } from '../../src/domain/types';
import { QbtDatabase } from '../../src/data/db';
import { persistAttemptAndSessionTransaction } from '../../src/data/repositories';
import { createAttempt } from '../../src/engine/attemptFactory';
import { createSessionRecord, endSessionRecord, updateSessionProgress } from '../../src/engine/sessionFactory';
import { makeQuestionV1 } from '../fixtures/questionV1';

const databases: QbtDatabase[] = [];

function createDatabase(name: string): QbtDatabase {
  const database = new QbtDatabase(name);
  databases.push(database);
  return database;
}

function makeStudyState(): StudyState {
  return {
    questionId: 'q',
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

function makeAttempt(sessionId = 's1') {
  const question = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
  return createAttempt({
    attemptId: 'a1',
    question,
    sessionId,
    mode: 'normal',
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
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe('P0 #6 atomic persistence', () => {
  it('round-trips every PersistedAttempt field exactly with Session progress and StudyState', async () => {
    const database = createDatabase('qbt-p0-6-atomic-roundtrip');
    const session = createSessionRecord({
      sessionId: 's1',
      mode: 'normal',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 2,
    });
    await database.sessions.add(session);
    const attempt = makeAttempt();
    const progressed = updateSessionProgress(session, 1, null);
    const studyState = makeStudyState();

    await persistAttemptAndSessionTransaction(attempt, progressed, studyState, database);

    expect(await database.attempts.get(attempt.attemptId)).toEqual(attempt);
    expect(await database.sessions.get(session.sessionId)).toEqual(progressed);
    expect(await database.studyStates.get([studyState.questionId, studyState.revisionId])).toEqual(studyState);
  });

  it('commits the final Attempt and terminal Session state in the same transaction', async () => {
    const database = createDatabase('qbt-p0-6-atomic-terminal');
    const session = createSessionRecord({
      sessionId: 's1',
      mode: 'normal',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 1,
    });
    await database.sessions.add(session);
    const attempt = makeAttempt();
    const ended = endSessionRecord(
      session,
      'completed',
      attempt.completedAt,
      { consumedQuestionCount: 1 },
    );

    await persistAttemptAndSessionTransaction(attempt, ended, null, database);

    expect(await database.attempts.get('a1')).toEqual(attempt);
    expect(await database.sessions.get('s1')).toEqual(ended);
    expect(await database.sessions.get('s1')).toMatchObject({
      endReason: 'completed',
      endedAt: attempt.completedAt,
      endedAtEpochMs: attempt.completedAtEpochMs,
      consumedQuestionCount: 1,
    });
  });

  it('rolls back Attempt and Session writes when a later StudyState write fails', async () => {
    const database = createDatabase('qbt-p0-6-atomic-late-failure');
    const session = createSessionRecord({
      sessionId: 's1',
      mode: 'normal',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 2,
    });
    await database.sessions.add(session);
    const attempt = makeAttempt();
    const progressed = updateSessionProgress(session, 1, null);
    const invalidStudyState = {
      ...makeStudyState(),
      questionId: undefined,
    } as unknown as StudyState;

    await expect(
      persistAttemptAndSessionTransaction(attempt, progressed, invalidStudyState, database),
    ).rejects.toThrow();

    expect(await database.attempts.get('a1')).toBeUndefined();
    expect(await database.sessions.get('s1')).toEqual(session);
    expect(await database.studyStates.count()).toBe(0);
  });

  it('rejects a mismatched Attempt/Session pair before any write', async () => {
    const database = createDatabase('qbt-p0-6-session-id-mismatch');
    const session = createSessionRecord({
      sessionId: 's1',
      mode: 'normal',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 1,
    });
    await database.sessions.add(session);
    const attempt = makeAttempt('different-session');
    const ended = endSessionRecord(
      session,
      'completed',
      attempt.completedAt,
      { consumedQuestionCount: 1 },
    );

    await expect(persistAttemptAndSessionTransaction(attempt, ended, null, database)).rejects.toThrow(
      'Attempt and Session IDs do not match',
    );
    expect(await database.attempts.count()).toBe(0);
    expect(await database.sessions.get('s1')).toEqual(session);
  });
});
