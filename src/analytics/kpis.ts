import type { Attempt } from '../domain/types';
import { selectFirstExposureScoredAttempts } from './firstExposure';

export interface Phase1Kpis {
  readonly scoredAttempts: number;
  readonly accuracy: number | null;
  readonly firstExposureAccuracy: number | null;
  readonly correctMedianBuzzRatio: number | null;
  readonly incorrectMedianBuzzRatio: number | null;
  readonly correctMedianResponseTimeMs: number | null;
}

export type AttemptAggregateFilter = (attempt: Attempt) => boolean;

export function isScoredAttempt(attempt: Attempt): boolean {
  return attempt.outcome === 'correct' || attempt.outcome === 'incorrect';
}

function includeAllAttempts(): boolean {
  return true;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  return left === undefined || right === undefined ? null : (left + right) / 2;
}

/**
 * Calculate Phase 1 KPIs from immutable raw Attempt history.
 *
 * First Exposure is always determined globally from the full history before
 * period/revision/etc. aggregateFilter is applied. Other scored KPIs operate
 * on the filtered aggregation scope.
 */
export function calculatePhase1Kpis(
  attempts: readonly Attempt[],
  aggregateFilter: AttemptAggregateFilter = includeAllAttempts,
): Phase1Kpis {
  const scopedAttempts = attempts.filter(aggregateFilter);
  const scored = scopedAttempts.filter(isScoredAttempt);
  const correct = scored.filter((attempt) => attempt.outcome === 'correct');
  const incorrect = scored.filter((attempt) => attempt.outcome === 'incorrect');

  const firstExposure = selectFirstExposureScoredAttempts(attempts).filter(aggregateFilter);
  const firstCorrect = firstExposure.filter((attempt) => attempt.outcome === 'correct').length;

  return {
    scoredAttempts: scored.length,
    accuracy: scored.length === 0 ? null : correct.length / scored.length,
    firstExposureAccuracy: firstExposure.length === 0 ? null : firstCorrect / firstExposure.length,
    correctMedianBuzzRatio: median(
      correct.flatMap((attempt) => (attempt.buzzRatio === null ? [] : [attempt.buzzRatio])),
    ),
    incorrectMedianBuzzRatio: median(
      incorrect.flatMap((attempt) => (attempt.buzzRatio === null ? [] : [attempt.buzzRatio])),
    ),
    correctMedianResponseTimeMs: median(
      correct.flatMap((attempt) => (attempt.responseTimeMs === null ? [] : [attempt.responseTimeMs])),
    ),
  };
}
