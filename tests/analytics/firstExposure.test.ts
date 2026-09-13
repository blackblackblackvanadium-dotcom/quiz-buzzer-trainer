import { describe, expect, it } from 'vitest';
import type { Attempt, LegacyAttempt, PersistedAttempt } from '../../src/domain/types';
import { selectFirstExposureScoredAttempts } from '../../src/analytics/firstExposure';
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
    buzzIndex: outcome === 'pass' || outcome === 'skip' || outcome === 'aborted' ? null : 5,
    totalGraphemeCount: outcome === 'pass' || outcome === 'skip' || outcome === 'aborted' ? null : 10,
    buzzRatio: outcome === 'pass' || outcome === 'skip' || outcome === 'aborted' ? null : 0.5,
    buzzTimeMs: outcome === 'pass' || outcome === 'skip' || outcome === 'aborted' ? null : 300,
    responseTimeMs: outcome === 'pass' || outcome === 'skip' || outcome === 'aborted' ? null : 1000,
    kimari: null,
    visibleTextAtBuzz: outcome === 'pass' || outcome === 'skip' || outcome === 'aborted' ? null : 'abcde',
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
  return selectFirstExposureScoredAttempts(attempts).map((attempt) => attempt.attemptId);
}

describe('QBT-05 First-Exposure Implementation Contract', () => {
  it('FE-01 groups by logical questionId rather than revisionId', () => {
    const attempts = [
      currentAttempt({ attemptId: 'a-old', questionId: 'q-1', revisionId: 'r1', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-01T00:00:01.000Z' }),
      currentAttempt({ attemptId: 'a-new', questionId: 'q-1', revisionId: 'r2', outcome: 'correct', isCorrect: true, completedAt: '2026-01-02T00:00:01.000Z' }),
    ];
    expect(exposureIds(attempts)).toEqual(['a-old']);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(0);
  });

  it('FE-02 revision changes never restore first-seen status', () => {
    const attempts = [
      currentAttempt({ attemptId: 'a-r1', questionId: 'q-1', revisionId: 'r1', completedAt: '2026-01-01T00:00:01.000Z' }),
      currentAttempt({ attemptId: 'a-r2', questionId: 'q-1', revisionId: 'r2', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-02T00:00:01.000Z' }),
      currentAttempt({ attemptId: 'a-r3', questionId: 'q-1', revisionId: 'r3', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-03T00:00:01.000Z' }),
    ];
    expect(exposureIds(attempts)).toEqual(['a-r1']);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(1);
  });

  it('FE-03 chooses the earliest scored Attempt across interleaved revisions', () => {
    const attempts = [
      currentAttempt({ attemptId: 'q1-late-r2', questionId: 'q-1', revisionId: 'r2', completedAt: '2026-01-04T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'q2-first', questionId: 'q-2', revisionId: 'r7', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-02T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'q1-first-r1', questionId: 'q-1', revisionId: 'r1', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'q2-later', questionId: 'q-2', revisionId: 'r8', completedAt: '2026-01-03T00:00:00.000Z' }),
    ];
    expect(exposureIds(attempts)).toEqual(['q1-first-r1', 'q2-first']);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(0);
  });

  it('FE-04 first correct then incorrect remains first-exposure correct', () => {
    const attempts = [
      currentAttempt({ attemptId: 'first-correct', completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'later-wrong', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(1);
  });

  it('FE-05 first incorrect then correct remains first-exposure incorrect', () => {
    const attempts = [
      currentAttempt({ attemptId: 'first-wrong', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'later-correct', completedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(0);
  });

  it('FE-06 Pass is excluded before first-exposure selection', () => {
    const attempts = [
      currentAttempt({ attemptId: 'pass', outcome: 'pass', isCorrect: null, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'first-scored', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    expect(exposureIds(attempts)).toEqual(['first-scored']);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(0);
  });

  it('FE-07 Skip is excluded before first-exposure selection', () => {
    const attempts = [
      currentAttempt({ attemptId: 'skip', outcome: 'skip', isCorrect: null, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'first-scored', completedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    expect(exposureIds(attempts)).toEqual(['first-scored']);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(1);
  });

  it('FE-08 questions with only Pass/Skip do not enter the First-Exposure denominator', () => {
    const attempts = [
      currentAttempt({ attemptId: 'pass', outcome: 'pass', isCorrect: null }),
      currentAttempt({ attemptId: 'skip', outcome: 'skip', isCorrect: null, completedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    expect(exposureIds(attempts)).toEqual([]);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBeNull();
  });

  it('FE-09 equal timestamps use attemptId ascending as deterministic tie-break', () => {
    const timestamp = '2026-01-01T00:00:01.000Z';
    const attempts = [
      currentAttempt({ attemptId: 'b-attempt', outcome: 'incorrect', isCorrect: false, revisionId: 'r2', completedAt: timestamp }),
      currentAttempt({ attemptId: 'a-attempt', outcome: 'correct', isCorrect: true, revisionId: 'r1', completedAt: timestamp }),
    ];
    expect(exposureIds(attempts)).toEqual(['a-attempt']);
    expect(exposureIds([...attempts].reverse())).toEqual(['a-attempt']);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBe(1);
  });

  it('FE-10 imported historical scored Attempt is ordered by its event timestamp, not import/array order', () => {
    const alreadyPresent = currentAttempt({
      attemptId: 'current-later',
      questionId: 'q-1',
      revisionId: 'r2',
      completedAt: '2026-01-02T00:00:00.000Z',
      outcome: 'correct',
      isCorrect: true,
    });
    const importedHistorical = legacyAttempt({
      attemptId: 'imported-older',
      questionId: 'q-1',
      revisionId: 'r1',
      completedAt: '2025-12-31T23:59:59.000Z',
      outcome: 'incorrect',
    });
    expect(exposureIds([alreadyPresent, importedHistorical])).toEqual(['imported-older']);
    expect(calculatePhase1Kpis([alreadyPresent, importedHistorical]).firstExposureAccuracy).toBe(0);
  });

  it('FE-11 imported historical data may change derived First-Exposure KPI without mutating raw Attempts', () => {
    const current = currentAttempt({ attemptId: 'current', outcome: 'correct', isCorrect: true });
    const before = JSON.stringify(current);
    expect(calculatePhase1Kpis([current]).firstExposureAccuracy).toBe(1);

    const historical = legacyAttempt({ attemptId: 'historical', outcome: 'incorrect', completedAt: '2025-01-01T00:00:00.000Z' });
    expect(calculatePhase1Kpis([current, historical]).firstExposureAccuracy).toBe(0);
    expect(JSON.stringify(current)).toBe(before);
  });

  it('FE-12 mixed logical questions compute numerator/denominator once per questionId', () => {
    const attempts = [
      currentAttempt({ attemptId: 'q1-r1-wrong', questionId: 'q1', revisionId: 'r1', outcome: 'incorrect', isCorrect: false, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'q1-r2-correct', questionId: 'q1', revisionId: 'r2', completedAt: '2026-01-02T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'q2-r1-correct', questionId: 'q2', revisionId: 'r1', completedAt: '2026-01-01T00:00:01.000Z' }),
      currentAttempt({ attemptId: 'q3-pass', questionId: 'q3', revisionId: 'r1', outcome: 'pass', isCorrect: null, completedAt: '2026-01-01T00:00:02.000Z' }),
      currentAttempt({ attemptId: 'q3-r2-correct', questionId: 'q3', revisionId: 'r2', completedAt: '2026-01-03T00:00:00.000Z' }),
    ];
    expect(exposureIds(attempts)).toEqual(['q1-r1-wrong', 'q2-r1-correct', 'q3-r2-correct']);
    expect(calculatePhase1Kpis(attempts).firstExposureAccuracy).toBeCloseTo(2 / 3);
  });

  it('FE-13 unscored aborted history is excluded like other non-scored outcomes', () => {
    const attempts = [
      currentAttempt({ attemptId: 'aborted', outcome: 'aborted', isCorrect: null, completedAt: '2026-01-01T00:00:00.000Z' }),
      currentAttempt({ attemptId: 'scored', completedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    expect(exposureIds(attempts)).toEqual(['scored']);
  });
});
