import type { Attempt } from '../domain/types';

function isExposureAttempt(attempt: Attempt): boolean {
  return attempt.outcome !== 'aborted';
}

function isScoredAttempt(attempt: Attempt): boolean {
  return attempt.outcome === 'correct' || attempt.outcome === 'incorrect';
}

function compareCodeUnitStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * QBT-05 stable event identifier for deterministic First-Exposure ordering.
 * Phase 1 Attempt identity is attemptId; compare it by JS string code-unit order,
 * never by locale-sensitive collation.
 */
export function stableAttemptEventId(attempt: Attempt): string {
  return attempt.attemptId;
}

/**
 * QBT-05 First-Exposure ordering contract.
 *
 * - Earlier original event timestamp (completedAt) wins, independent of array/import order.
 * - Equal timestamps are resolved by stableAttemptEventId in binary/code-unit ascending order.
 * - localeCompare/Intl collation must not participate in the ordering.
 */
export function compareFirstExposureOrder(a: Attempt, b: Attempt): number {
  const timestampOrder = compareCodeUnitStrings(a.completedAt, b.completedAt);
  if (timestampOrder !== 0) return timestampOrder;
  return compareCodeUnitStrings(stableAttemptEventId(a), stableAttemptEventId(b));
}

/**
 * Select the global first exposure for each logical questionId.
 *
 * correct / incorrect / pass / skip consume exposure.
 * aborted does not consume exposure.
 * revisionId never resets first-seen state.
 */
export function selectFirstExposureAttempts(attempts: readonly Attempt[]): Attempt[] {
  const firstByLogicalQuestion = new Map<string, Attempt>();

  for (const attempt of attempts.filter(isExposureAttempt).sort(compareFirstExposureOrder)) {
    if (!firstByLogicalQuestion.has(attempt.questionId)) {
      firstByLogicalQuestion.set(attempt.questionId, attempt);
    }
  }

  return [...firstByLogicalQuestion.values()];
}

/**
 * First-Exposure Accuracy denominator: only questions whose global first exposure
 * is correct/incorrect. A first pass/skip permanently consumes first exposure but
 * excludes that logical question from this KPI denominator.
 */
export function selectFirstExposureScoredAttempts(attempts: readonly Attempt[]): Attempt[] {
  return selectFirstExposureAttempts(attempts).filter(isScoredAttempt);
}
