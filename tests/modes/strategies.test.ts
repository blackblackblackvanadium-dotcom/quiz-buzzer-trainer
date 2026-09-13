import { describe, expect, it } from 'vitest';
import type { StudyState } from '../../src/domain/types';
import { selectQuestionsForMode } from '../../src/modes/strategies';
import { makeQuestionV1 } from '../fixtures/questionV1';

const q = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
const due: StudyState = {
  questionId: 'q', revisionId: 'r1', dueAt: '2026-01-01T00:00:00Z', intervalDays: 1, easeFactor: 2.5, repetitions: 1,
  lapses: 0, bestBuzzIndex: null, bestBuzzRatio: null, bestResponseTimeMs: null, correctCount: 0, attemptCount: 0, streak: 0,
};

describe('mode selection', () => {
  it('review only selects due question revisions', () => {
    expect(selectQuestionsForMode('review', [q], [due], '2026-09-13T00:00:00Z')).toHaveLength(1);
    expect(selectQuestionsForMode('review', [q], [{ ...due, dueAt: '2027-01-01T00:00:00Z' }], '2026-09-13T00:00:00Z')).toHaveLength(0);
  });
});
