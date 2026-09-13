import { describe, expect, it } from 'vitest';
import type { Attempt, LegacyAttempt, PersistedAttempt } from '../../src/domain/types';
import {
  compareFirstExposureOrder,
  selectFirstExposureAttempts,
  selectFirstExposureScoredAttempts,
  stableAttemptEventId,
} from '../../src/analytics/firstExposure';
import { calculatePhase1Kpis } from '../../src/analytics/kpis';

function currentAttempt(overrides: Partial<PersistedAttempt> = {}): PersistedAttempt {
  const completedAt = overrides.completedAt ?? '2026-01-01T00:00:01.000Z';
  const startedAt = overrides.startedAt ?? '2026-01-01T00:00:00.000Z';
  const outcome = overrides.outcome ?? 'correct';

  return {
    attemptId: 'a-001',
    questionId: 'q-1',
    revisionId: 'r1',
    sessionId: 's-1',
    mode: 'normal',
    outcome,
    isCorrect: outcome === 'correct' ? true : outcome === 'incorrect' ? false : null,
    startedAtEpochMs: Date.parse(startedAt),
    completedAtEpochMs: Date.parse(completedAt),
    judgeKind: outcome === 'correct' ? 'canonical' : outcome === 'incorrect' ? 'incorrect' : null,
    submittedAnswer: outcome === 'correct' ? 'answer' : outcome === 'incorrect' ? 'wrong' : null,
    startedAt,
    completedAt,
    buzzIndex: outcome === 'correct' || outcome === 'incorrect' ? 5 : null,
    totalGraphemeCount: outcome === 'correct' || outcome === 'incorrect' ? 10 : null,
    buzzRatio: outcome === 'correct' || outcome === 'incorrect' ? 0.5 : null,
    buzzTimeMs: outcome === 'correct' || outcome === 'incorrect' ? 300 : null,
    responseTimeMs: outcome === 'correct' || outcome === 'incorrect' ? 1000 : null,
    kimari: null,
    visibleTextAtBuzz: outcome === 'correct' || outcome === 'incorrect' ? 'abcde' : null,
    ...overrides,
  };
}

function legacyAttempt(overrides: Partial<LegacyAttempt> = {}): LegacyAttempt {
  const outcome = overrides.outcome ?? 'correct';

  return {
    attemptId: 'legacy-001',
    questionId: 'q-1',
    revisionId: 'r0',
    sessionId: 'legacy-session',
    mode: 'normal',
    outcome,
    judgeKind: outcome === 'correct' ? 'canonical' : outcome === 'incorrect' ? 'incorrect' : null,
    submittedAnswer: outcome === 'correct' ? 'answer' : outcome === 'incorrect' ? 'wrong' : null,
    startedAt: '2025-12-31T23:59:58.000Z',
    completedAt: '2025-12-31T23:59:59.000Z',
    buzzIndex: outcome === 'correct' || outcome === 'incorrect' ? 5 : null,
    buzzRatio: outcome === 'correct' || outcome === 'incorrect' ? 0.5 : null,
    buzzTimeMs: outcome === 'correct' || outcome === 'incorrect' ? 300 : null,
    responseTimeMs: outcome === 'correct' || outcome === 'incorrect' ? 1000 : null,
    visibleTextAtBuzz: outcome === 'correct' || outcome === 'incorrect' ? 'abcde' : null,
    ...overrides,
  };
}

function exposureIds(attempts: readonly Attempt[]): string[] {
  return selectFirstExposureAttempts(attempts).map((attempt) => attempt.attemptId);
}

function scoredExposureIds(attempts: readonly Attempt[]): string[] {
  return selectFirstExposureScoredAttempts(attempts).map((attempt) => attempt.attemptId);
}

describe('QBT-05 First-Exposure Implementation Contract', () => {
  it('FE-001 groups globally by logical questionId, not revisionId', () => {
    const attempts = [
      currentAttempt({ attemptId: 'r1-first', revisionId: 'r1', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-01T00:00:01.000Z' }),
      currentAttempt({ attemptId: 'r2-later', revisionId: 'r2', outcome: 'correct', isCorrect: true, completedAt: '2026-01-02T00:00:01.000Z' }),
    ];

    expect(exposureIds(attempts)).toEqual(['r1-first']);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(0);
  });

  it('FE-002 first incorrect remains immutable after a later correct', () => {
    const attempts = [
      currentAttempt({ attemptId: 'first-wrong', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'later-correct', outcome: 'correct', isCorrect: true, completedAt: '2026-01-02T00:00:00.000Z' }),
    ];

    expect(scoredExposureIds(attempts)).toEqual(['first-wrong']);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(0);
  });

  it('FE-003 pass consumes first exposure and excludes the question from the Accuracy denominator', () => {
    const attempts = [
      currentAttempt({ attemptId: 'first-pass', outcome: 'pass', isCorrect: null, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'later-correct', outcome: 'correct', isCorrect: true, completedAt: '2026-01-02T00:00:00.000Z' }),
    ];

    expect(exposureIds(attempts)).toEqual(['first-pass']);
    expect(scoredExposureIds(attempts)).toEqual([]);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBeNull();
  });

  it('FE-004 skip consumes first exposure and excludes the question from the Accuracy denominator', () => {
    const attempts = [
      currentAttempt({ attemptId: 'first-skip', outcome: 'skip', isCorrect: null, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'later-wrong', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-02T00:00:00.000Z' }),
    ];

    expect(exposureIds(attempts)).toEqual(['first-skip']);
    expect(scoredExposureIds(attempts)).toEqual([]);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBeNull();
  });

  it('FE-005 aborted does not consume exposure', () => {
    const attempts = [
      currentAttempt({ attemptId: 'aborted', outcome: 'aborted', isCorrect: null, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'first-real-exposure', outcome: 'correct', isCorrect: true, completedAt: '2026-01-02T00:00:00.000Z' }),
    ];

    expect(exposureIds(attempts)).toEqual(['first-real-exposure']);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(1);
  });

  it('FE-006 aborted-only history creates no exposure', () => {
    const attempts = [
      currentAttempt({ attemptId: 'aborted-r1', revisionId: 'r1', outcome: 'aborted', isCorrect: null }),
      currentAttempt({ attemptId: 'aborted-r2', revisionId: 'r2', outcome: 'aborted', isCorrect: null, completedAt: '2026-01-02T00:00:00.000Z' }),
    ];

    expect(exposureIds(attempts)).toEqual([]);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBeNull();
  });

  it('FE-007 a revision change never restores first-seen status after pass', () => {
    const attempts = [
      currentAttempt({ attemptId: 'r1-pass', revisionId: 'r1', outcome: 'pass', isCorrect: null, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'r2-correct', revisionId: 'r2', outcome: 'correct', isCorrect: true, completedAt: '2026-01-02T00:00:00.000Z' }),
    ];

    expect(exposureIds(attempts)).toEqual(['r1-pass']);
    expect(scoredExposureIds(attempts)).toEqual([]);
  });

  it('FE-008 mixed questions count only scored global first exposures in numerator and denominator', () => {
    const attempts = [
      currentAttempt({ attemptId: 'q1-pass', questionId: 'q1', outcome: 'pass', isCorrect: null, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'q1-correct', questionId: 'q1', outcome: 'correct', isCorrect: true, completedAt: '2026-01-03T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'q2-correct', questionId: 'q2', outcome: 'correct', isCorrect: true, completedAt: '2026-01-01T00:00:01.000Z' }),
      currentAttempt({ attemptId: 'q3-wrong', questionId: 'q3', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-01T00:00:02.000Z' }),
    ];

    expect(scoredExposureIds(attempts)).toEqual(['q2-correct', 'q3-wrong']);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(0.5);
  });

  it('FE-009 imported historical scored Attempt is reinserted by original event timestamp', () => {
    const current = currentAttempt({
      attemptId: 'current-later',
      revisionId: 'r2',
      outcome: 'correct',
      isCorrect: true,
      completedAt: '2026-01-02T00:00:00.000Z',
    });
    const historical = legacyAttempt({
      attemptId: 'historical-earlier',
      revisionId: 'r1',
      outcome: 'incorrect',
      completedAt: '2025-12-31T23:59:59.000Z',
    });

    expect(scoredExposureIds([current, historical])).toEqual(['historical-earlier']);
    expect(calculatePhase1Kpis([current, historical]).firstExposureAccuracy).toBe(0);
  });

  it('FE-010 imported historical pass consumes exposure before a later current correct', () => {
    const current = currentAttempt({
      attemptId: 'current-correct',
      outcome: 'correct',
      isCorrect: true,
      completedAt: '2026-01-02T00:00:00.000Z',
    });
    const historicalPass = legacyAttempt({
      attemptId: 'historical-pass',
      outcome: 'pass',
      completedAt: '2025-12-31T23:59:59.000Z',
    });

    expect(exposureIds([current, historicalPass])).toEqual(['historical-pass']);
    expect(scoredExposureIds([current, historicalPass])).toEqual([]);
  });

  it('FE-011 imported historical aborted Attempt does not consume exposure', () => {
    const current = currentAttempt({
      attemptId: 'current-correct',
      outcome: 'correct',
      isCorrect: true,
      completedAt: '2026-01-02T00:00:00.000Z',
    });
    const historicalAbort = legacyAttempt({
      attemptId: 'historical-abort',
      outcome: 'aborted',
      completedAt: '2025-12-31T23:59:59.000Z',
    });

    expect(exposureIds([current, historicalAbort])).toEqual(['current-correct']);
    expect(calculatePhase1Kpis([current, historicalAbort]).firstExposureAccuracy).toBe(1);
  });

  it('FE-012 array/import order does not override event timestamp ordering', () => {
    const earlier = currentAttempt({ attemptId: 'earlier', completedAt: '2026-01-01T00:00:00.000Z' });
    const later = currentAttempt({ attemptId: 'later', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-02T00:00:00.000Z' });

    expect(scoredExposureIds([later, earlier])).toEqual(['earlier']);
    expect(scoredExposureIds([earlier, later])).toEqual(['earlier']);
  });

  it('FE-013 equal timestamps use stableAttemptEventId code-unit ascending, not locale collation', () => {
    const timestamp = '2026-01-01T00:00:00.000Z';
    const upper = currentAttempt({ attemptId: 'Z-event', outcome: 'incorrect', isCorrect: false, completedAt: timestamp });
    const lower = currentAttempt({ attemptId: 'a-event', outcome: 'correct', isCorrect: true, completedAt: timestamp });

    expect(stableAttemptEventId(upper)).toBe('Z-event');
    expect(compareFirstExposureOrder(upper, lower)).toBeLessThan(0);
    expect(scoredExposureIds([lower, upper])).toEqual(['Z-event']);
    expect(calculatePhase1Kpis([lower, upper]).firstExposureAccuracy).toBe(0);
  });

  it('FE-014 equal-timestamp tie resolution is deterministic across reversed input order', () => {
    const timestamp = '2026-01-01T00:00:00.000Z';
    const a = currentAttempt({ attemptId: 'a-event', outcome: 'correct', isCorrect: true, completedAt: timestamp });
    const b = currentAttempt({ attemptId: 'b-event', outcome: 'incorrect', isCorrect: false, completedAt: timestamp });

    expect(scoredExposureIds([b, a])).toEqual(['a-event']);
    expect(scoredExposureIds([a, b])).toEqual(['a-event']);
  });

  it('FE-015 code-unit ordering remains deterministic for non-ASCII stable event IDs', () => {
    const timestamp = '2026-01-01T00:00:00.000Z';
    const ascii = currentAttempt({ attemptId: 'z-event', outcome: 'incorrect', isCorrect: false, completedAt: timestamp });
    const nonAscii = currentAttempt({ attemptId: 'é-event', outcome: 'correct', isCorrect: true, completedAt: timestamp });

    expect(compareFirstExposureOrder(ascii, nonAscii)).toBeLessThan(0);
    expect(scoredExposureIds([nonAscii, ascii])).toEqual(['z-event']);
  });

  it('FE-016 First-Exposure derivation does not mutate raw Attempts or input order', () => {
    const attempts = [
      currentAttempt({ attemptId: 'later', completedAt: '2026-01-02T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'earlier', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-01T00:00:00.000Z' }),
    ] as const;
    const before = JSON.stringify(attempts);

    selectFirstExposureAttempts(attempts);
    calculatePhase1Kpis(attempts);

    expect(JSON.stringify(attempts)).toBe(before);
    expect(attempts.map((attempt) => attempt.attemptId)).toEqual(['later', 'earlier']);
  });

  it('FE-017 a historical import may retroactively change derived First-Exposure without rewriting existing raw Attempt', () => {
    const current = currentAttempt({ attemptId: 'current', outcome: 'correct', isCorrect: true });
    const before = JSON.stringify(current);

    expect(calculatePhase1Kpis([current]).firstExposureAccuracy).toBe(1);

    const historical = legacyAttempt({
      attemptId: 'historical',
      outcome: 'incorrect',
      completedAt: '2025-01-01T00:00:00.000Z',
    });

    expect(calculatePhase1Kpis([current, historical]).firstExposureAccuracy).toBe(0);
    expect(JSON.stringify(current)).toBe(before);
  });

  it('FE-018 period filter is applied after global First-Exposure selection', () => {
    const januaryFirst = currentAttempt({
      attemptId: 'jan-first',
      outcome: 'correct',
      isCorrect: true,
      completedAt: '2026-01-10T00:00:00.000Z',
    });
    const februaryLater = currentAttempt({
      attemptId: 'feb-later',
      outcome: 'incorrect',
      isCorrect: false,
      completedAt: '2026-02-10T00:00:00.000Z',
    });

    const februaryOnly = (attempt: Attempt) => attempt.completedAt.startsWith('2026-02');
    const kpi = calculatePhase1Kpis([februaryLater, januaryFirst], februaryOnly);

    expect(kpi.scoredAttempts).toBe(1);
    expect(kpi.accuracy).toBe(0);
    expect(kpi.firstExposureAccuracy).toBeNull();
  });

  it('FE-019 revision filter is applied after global First-Exposure selection', () => {
    const r1First = currentAttempt({
      attemptId: 'r1-first',
      revisionId: 'r1',
      outcome: 'incorrect',
      isCorrect: false,
      completedAt: '2026-01-01T00:00:00.000Z',
    });
    const r2Later = currentAttempt({
      attemptId: 'r2-later',
      revisionId: 'r2',
      outcome: 'correct',
      isCorrect: true,
      completedAt: '2026-01-02T00:00:00.000Z',
    });

    const r2Only = (attempt: Attempt) => attempt.revisionId === 'r2';
    const kpi = calculatePhase1Kpis([r2Later, r1First], r2Only);

    expect(kpi.scoredAttempts).toBe(1);
    expect(kpi.accuracy).toBe(1);
    expect(kpi.firstExposureAccuracy).toBeNull();
  });

  it('FE-020 pass/skip exposure remains consumed even when a later scored Attempt is inside the aggregate filter', () => {
    const firstPass = currentAttempt({
      attemptId: 'jan-pass',
      outcome: 'pass',
      isCorrect: null,
      completedAt: '2026-01-10T00:00:00.000Z',
    });
    const laterCorrect = currentAttempt({
      attemptId: 'feb-correct',
      outcome: 'correct',
      isCorrect: true,
      completedAt: '2026-02-10T00:00:00.000Z',
    });

    const februaryOnly = (attempt: Attempt) => attempt.completedAt.startsWith('2026-02');
    const kpi = calculatePhase1Kpis([laterCorrect, firstPass], februaryOnly);

    expect(kpi.scoredAttempts).toBe(1);
    expect(kpi.accuracy).toBe(1);
    expect(kpi.firstExposureAccuracy).toBeNull();
  });
});
