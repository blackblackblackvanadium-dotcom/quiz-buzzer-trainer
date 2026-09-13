import { describe, expect, it } from 'vitest';
import type { PersistedAttempt } from '../../src/domain/types';
import { createSessionRecord } from '../../src/engine/sessionFactory';
import { QbtDatabase } from '../../src/data/db';
import { AttemptRepository, SessionRepository } from '../../src/data/repositories';

function persistedAttempt(overrides: Partial<PersistedAttempt> = {}): PersistedAttempt {
  return {
    attemptId: 'a1',
    questionId: 'q1',
    revisionId: 'r1',
    sessionId: 's1',
    mode: 'normal',
    outcome: 'correct',
    isCorrect: true,
    startedAtEpochMs: Date.parse('2026-09-14T00:00:00.000Z'),
    completedAtEpochMs: Date.parse('2026-09-14T00:00:01.000Z'),
    judgeKind: 'canonical',
    submittedAnswer: 'Answer',
    startedAt: '2026-09-14T00:00:00.000Z',
    completedAt: '2026-09-14T00:00:01.000Z',
    buzzIndex: 1,
    totalGraphemeCount: 4,
    buzzRatio: 0.25,
    buzzTimeMs: 100,
    responseTimeMs: 200,
    kimari: null,
    visibleTextAtBuzz: 'a',
    ...overrides,
  };
}

describe('P0 #6 persistence boundary validation', () => {
  it('rejects a PersistedAttempt whose timestamp aliases disagree', async () => {
    const database = new QbtDatabase('qbt-p0-6-attempt-boundary');
    const repo = new AttemptRepository(database);
    try {
      const invalid = persistedAttempt({ startedAtEpochMs: 0 });
      await expect(repo.add(invalid)).rejects.toThrow('startedAt aliases are inconsistent');
      expect(await database.attempts.count()).toBe(0);
    } finally {
      database.close();
      await database.delete();
    }
  });

  it('rejects Session endReason without endedAt at the repository boundary', async () => {
    const database = new QbtDatabase('qbt-p0-6-session-boundary');
    const repo = new SessionRepository(database);
    try {
      const active = createSessionRecord({
        sessionId: 's1',
        mode: 'normal',
        startedAt: '2026-09-14T00:00:00.000Z',
        targetQuestionCount: 1,
      });
      const invalid = { ...active, endReason: 'completed' as const };
      await expect(repo.put(invalid)).rejects.toThrow('endReason requires endedAt');
      expect(await database.sessions.count()).toBe(0);
    } finally {
      database.close();
      await database.delete();
    }
  });
});
