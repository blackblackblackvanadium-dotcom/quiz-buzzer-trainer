import { describe, expect, it } from 'vitest';
import type { StudyState } from '../../src/domain/types';
import {
  resolveKimariReference,
  selectKimariPlan,
  selectQuestionsForMode,
} from '../../src/modes/strategies';
import { makeQuestionV1, TEST_PROVENANCE } from '../fixtures/questionV1';

const q = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
const due: StudyState = {
  questionId: 'q', revisionId: 'r1', dueAt: '2026-01-01T00:00:00Z', intervalDays: 1, easeFactor: 2.5, repetitions: 1,
  lapses: 0, bestBuzzIndex: null, bestBuzzRatio: null, bestResponseTimeMs: null, correctCount: 0, attemptCount: 0, streak: 0,
};

describe('mode selection', () => {
  it('Review only selects due question revisions', () => {
    expect(selectQuestionsForMode('review', [q], [due], '2026-09-13T00:00:00Z')).toHaveLength(1);
    expect(selectQuestionsForMode('review', [q], [{ ...due, dueAt: '2027-01-01T00:00:00Z' }], '2026-09-13T00:00:00Z')).toHaveLength(0);
  });

  it('Normal preserves the source pool and order', () => {
    const q2 = makeQuestionV1({ questionId: 'q2', revisionId: 'r1', revision: 1 });
    expect(selectQuestionsForMode('normal', [q, q2], [], '2026-09-13T00:00:00Z')).toEqual([q, q2]);
  });

  it('Survival uses the same source pool and order as Normal', () => {
    const q2 = makeQuestionV1({ questionId: 'q2', revisionId: 'r1', revision: 1 });
    expect(selectQuestionsForMode('survival', [q, q2], [], '2026-09-13T00:00:00Z')).toEqual([q, q2]);
  });

  it('Kimari selects only questions with one unambiguous valid reference', () => {
    const eligible = makeQuestionV1({
      questionId: 'eligible',
      revisionId: 'r1',
      revision: 1,
      prompt: 'abcdefghij',
      determiningPoints: [{
        id: 'kimari',
        method: 'human_semantic',
        requiredPrefixGraphemes: 4,
        provenance: TEST_PROVENANCE,
      }],
    });
    const missing = makeQuestionV1({
      questionId: 'missing',
      revisionId: 'r1',
      revision: 1,
      determiningPoints: [],
    });
    const ambiguous = makeQuestionV1({
      questionId: 'ambiguous',
      revisionId: 'r1',
      revision: 1,
      prompt: 'abcdefghij',
      determiningPoints: [
        { id: 'one', method: 'human_semantic', requiredPrefixGraphemes: 3, provenance: TEST_PROVENANCE },
        { id: 'two', method: 'rule_estimated', requiredPrefixGraphemes: 5, provenance: TEST_PROVENANCE },
      ],
    });

    expect(resolveKimariReference(eligible)).toMatchObject({ referenceBuzzIndex: 4 });
    expect(resolveKimariReference(missing)).toBeNull();
    expect(resolveKimariReference(ambiguous)).toBeNull();
    expect(selectKimariPlan([missing, eligible, ambiguous]).map((item) => item.question.questionId)).toEqual(['eligible']);
    expect(selectQuestionsForMode('kimari', [missing, eligible, ambiguous], [], '2026-09-13T00:00:00Z').map((item) => item.questionId)).toEqual(['eligible']);
  });
});
