import { describe, expect, it } from 'vitest';
import type { Attempt } from '../../src/domain/types';
import { calculatePhase1Kpis } from '../../src/analytics/kpis';

const base: Attempt = {
  attemptId: 'a1', questionId: 'q1', revisionId: 'r1', sessionId: 's', mode: 'normal', outcome: 'correct', judgeKind: 'canonical',
  submittedAnswer: 'x', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z', buzzIndex: 5, buzzRatio: 0.5,
  buzzTimeMs: 300, responseTimeMs: 1000, visibleTextAtBuzz: 'x',
};

describe('Phase 1 KPIs', () => {
  it('excludes pass/skip from scored metrics', () => {
    const kpi = calculatePhase1Kpis([
      base,
      { ...base, attemptId: 'a2', questionId: 'q2', outcome: 'incorrect', judgeKind: 'incorrect', buzzRatio: 0.8 },
      { ...base, attemptId: 'a3', questionId: 'q3', outcome: 'pass', judgeKind: null, buzzRatio: null },
    ]);
    expect(kpi.scoredAttempts).toBe(2);
    expect(kpi.accuracy).toBe(0.5);
  });
});
