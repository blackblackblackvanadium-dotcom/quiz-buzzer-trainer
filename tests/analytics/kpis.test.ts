import { describe, expect, it } from 'vitest';
import type { PersistedAttempt } from '../../src/domain/types';
import { calculatePhase1Kpis } from '../../src/analytics/kpis';

function attempt(overrides: Partial<PersistedAttempt> = {}): PersistedAttempt {
  const completedAt = overrides.completedAt ?? '2026-01-01T00:00:01.000Z';
  const startedAt = overrides.startedAt ?? '2026-01-01T00:00:00.000Z';
  const outcome = overrides.outcome ?? 'correct';
  return {
    attemptId: 'a1',
    questionId: 'q1',
    revisionId: 'r1',
    sessionId: 's',
    mode: 'normal',
    outcome,
    isCorrect: outcome === 'correct' ? true : outcome === 'incorrect' ? false : null,
    startedAtEpochMs: Date.parse(startedAt),
    completedAtEpochMs: Date.parse(completedAt),
    judgeKind: outcome === 'correct' ? 'canonical' : outcome === 'incorrect' ? 'incorrect' : null,
    submittedAnswer: outcome === 'correct' ? 'x' : outcome === 'incorrect' ? 'wrong' : null,
    startedAt,
    completedAt,
    buzzIndex: outcome === 'correct' || outcome === 'incorrect' ? 5 : null,
    totalGraphemeCount: outcome === 'correct' || outcome === 'incorrect' ? 10 : null,
    buzzRatio: outcome === 'correct' || outcome === 'incorrect' ? 0.5 : null,
    buzzTimeMs: outcome === 'correct' || outcome === 'incorrect' ? 300 : null,
    responseTimeMs: outcome === 'correct' || outcome === 'incorrect' ? 1000 : null,
    kimari: null,
    visibleTextAtBuzz: outcome === 'correct' || outcome === 'incorrect' ? 'x' : null,
    ...overrides,
  };
}

describe('Phase 1 KPI regression', () => {
  it('excludes pass and skip from all scored-only metrics', () => {
    const kpi = calculatePhase1Kpis([
      attempt({ attemptId: 'a1', questionId: 'q1', outcome: 'correct', isCorrect: true }),
      attempt({ attemptId: 'a2', questionId: 'q2', outcome: 'incorrect', isCorrect: false, buzzRatio: 0.8 }),
      attempt({ attemptId: 'a3', questionId: 'q3', outcome: 'pass', isCorrect: null, judgeKind: null, buzzRatio: null, responseTimeMs: null }),
      attempt({ attemptId: 'a4', questionId: 'q4', outcome: 'skip', isCorrect: null, judgeKind: null, buzzRatio: null, responseTimeMs: null }),
    ]);
    expect(kpi.scoredAttempts).toBe(2);
    expect(kpi.accuracy).toBe(0.5);
    expect(kpi.firstExposureAccuracy).toBe(0.5);
  });

  it('returns null scored-only KPIs when there are no scored Attempts', () => {
    const kpi = calculatePhase1Kpis([
      attempt({ attemptId: 'pass', outcome: 'pass', isCorrect: null }),
      attempt({ attemptId: 'skip', outcome: 'skip', isCorrect: null }),
    ]);
    expect(kpi).toEqual({
      scoredAttempts: 0,
      accuracy: null,
      firstExposureAccuracy: null,
      correctMedianBuzzRatio: null,
      incorrectMedianBuzzRatio: null,
      correctMedianResponseTimeMs: null,
    });
  });

  it('keeps overall Accuracy based on every scored Attempt, not only first exposures', () => {
    const kpi = calculatePhase1Kpis([
      attempt({ attemptId: 'q1-first-wrong', questionId: 'q1', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-01T00:00:01.000Z' }),
      attempt({ attemptId: 'q1-later-correct', questionId: 'q1', outcome: 'correct', isCorrect: true, completedAt: '2026-01-02T00:00:01.000Z' }),
      attempt({ attemptId: 'q2-first-correct', questionId: 'q2', outcome: 'correct', isCorrect: true, completedAt: '2026-01-01T00:00:02.000Z' }),
    ]);
    expect(kpi.scoredAttempts).toBe(3);
    expect(kpi.accuracy).toBeCloseTo(2 / 3);
    expect(kpi.firstExposureAccuracy).toBe(0.5);
  });

  it('keeps odd/even median calculations unchanged', () => {
    const kpi = calculatePhase1Kpis([
      attempt({ attemptId: 'c1', questionId: 'c1', buzzRatio: 0.2, responseTimeMs: 100 }),
      attempt({ attemptId: 'c2', questionId: 'c2', buzzRatio: 0.4, responseTimeMs: 300 }),
      attempt({ attemptId: 'c3', questionId: 'c3', buzzRatio: 0.8, responseTimeMs: 500 }),
      attempt({ attemptId: 'w1', questionId: 'w1', outcome: 'incorrect', isCorrect: false, buzzRatio: 0.3, responseTimeMs: 200 }),
      attempt({ attemptId: 'w2', questionId: 'w2', outcome: 'incorrect', isCorrect: false, buzzRatio: 0.7, responseTimeMs: 400 }),
    ]);
    expect(kpi.correctMedianBuzzRatio).toBe(0.4);
    expect(kpi.incorrectMedianBuzzRatio).toBe(0.5);
    expect(kpi.correctMedianResponseTimeMs).toBe(300);
  });

  it('ignores null metric values without changing scored counts', () => {
    const kpi = calculatePhase1Kpis([
      attempt({ attemptId: 'c-null', questionId: 'c-null', buzzRatio: null, responseTimeMs: null }),
      attempt({ attemptId: 'c-value', questionId: 'c-value', buzzRatio: 0.6, responseTimeMs: 450 }),
      attempt({ attemptId: 'w-null', questionId: 'w-null', outcome: 'incorrect', isCorrect: false, buzzRatio: null, responseTimeMs: null }),
    ]);
    expect(kpi.scoredAttempts).toBe(3);
    expect(kpi.correctMedianBuzzRatio).toBe(0.6);
    expect(kpi.incorrectMedianBuzzRatio).toBeNull();
    expect(kpi.correctMedianResponseTimeMs).toBe(450);
  });
});
