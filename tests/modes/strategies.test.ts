import { describe, expect, it } from 'vitest';
import type { QuestionRevision, StudyState } from '../../src/domain/types';
import { selectQuestionsForMode } from '../../src/modes/strategies';

const q: QuestionRevision = {
  questionId: 'q', revisionId: 'r', prompt: 'p', canonicalAnswer: 'a', acceptableAnswers: [], rejectedAnswers: [],
  category: 'c', pattern: 'p', difficulty: 1, tags: [], createdAt: '2026-01-01T00:00:00Z',
};
const due: StudyState = {
  questionId: 'q', revisionId: 'r', dueAt: '2026-01-01T00:00:00Z', intervalDays: 1, easeFactor: 2.5, repetitions: 1,
  lapses: 0, bestBuzzIndex: null, bestBuzzRatio: null, bestResponseTimeMs: null, correctCount: 0, attemptCount: 0, streak: 0,
};

describe('mode selection', () => {
  it('review only selects due question revisions', () => {
    expect(selectQuestionsForMode('review', [q], [due], '2026-09-13T00:00:00Z')).toHaveLength(1);
    expect(selectQuestionsForMode('review', [q], [{ ...due, dueAt: '2027-01-01T00:00:00Z' }], '2026-09-13T00:00:00Z')).toHaveLength(0);
  });
});
