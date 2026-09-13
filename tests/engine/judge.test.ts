import { describe, expect, it } from 'vitest';
import type { QuestionRevision } from '../../src/domain/types';
import { judgeAnswer } from '../../src/engine/judge';

const question: QuestionRevision = {
  questionId: 'q', revisionId: 'r', prompt: 'x', canonicalAnswer: 'Ａ・Ｂ',
  acceptableAnswers: ['AB', 'エービー'], rejectedAnswers: ['A B'],
  category: 'x', pattern: 'x', difficulty: 1, tags: [], createdAt: '2026-01-01T00:00:00Z',
};

describe('judgeAnswer', () => {
  it('checks rejected answer before canonical/acceptable matches after normalization', () => {
    expect(judgeAnswer(question, 'a-b').kind).toBe('rejected');
  });

  it('accepts NFKC/case/punctuation differences when not rejected', () => {
    const withoutCollision = { ...question, rejectedAnswers: [] };
    expect(judgeAnswer(withoutCollision, ' a b ')).toMatchObject({ kind: 'canonical', isCorrect: true });
  });
});
