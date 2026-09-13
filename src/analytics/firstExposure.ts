import type { Attempt } from '../domain/types';
import { isScoredAttempt } from './kpis';

/**
 * QBT-05 First-Exposure ordering contract.
 *
 * - Only scored Attempts (correct / incorrect) participate.
 * - Identity is logical questionId. revisionId never resets first exposure.
 * - Earlier completedAt wins, independent of array/import order.
 * - Equal completedAt is resolved deterministically by attemptId ascending.
 * - The function derives from immutable raw Attempts only; it stores no first-seen flag.
 */
export function compareFirstExposureOrder(a: Attempt, b: Attempt): number {
  const timestampOrder = a.completedAt.localeCompare(b.completedAt);
  if (timestampOrder !== 0) return timestampOrder;
  return a.attemptId.localeCompare(b.attemptId);
}

export function selectFirstExposureScoredAttempts(attempts: readonly Attempt[]): Attempt[] {
  const firstByLogicalQuestion = new Map<string, Attempt>();

  for (const attempt of attempts.filter(isScoredAttempt).sort(compareFirstExposureOrder)) {
    if (!firstByLogicalQuestion.has(attempt.questionId)) {
      firstByLogicalQuestion.set(attempt.questionId, attempt);
    }
  }

  return [...firstByLogicalQuestion.values()];
}
