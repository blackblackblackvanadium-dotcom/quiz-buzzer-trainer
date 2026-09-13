import { describe, expect, it } from 'vitest';
import { judgeAnswer } from '../../src/engine/judge';
import { makeQuestionV1 } from '../fixtures/questionV1';

const provenance = { method: 'test' } as const;
const question = makeQuestionV1({
  answers: {
    primaryAnswer: { id: 'primary', text: 'Ａ・Ｂ', provenance },
    acceptedAnswers: [
      { id: 'accepted-1', text: 'AB', relation: 'alternative_spelling', provenance },
      { id: 'accepted-2', text: 'エービー', relation: 'alternative_reading', provenance },
    ],
    rejectedAnswers: [{ id: 'rejected-1', text: 'A B', rejectionReason: 'common_mistake', provenance }],
  },
});

describe('judgeAnswer', () => {
  it('checks rejected answer before primary/accepted matches after normalization', () => {
    expect(judgeAnswer(question, 'a-b').kind).toBe('rejected');
  });

  it('accepts NFKC/case/punctuation differences when not rejected', () => {
    const withoutCollision = makeQuestionV1({
      ...question,
      answers: { ...question.answers, rejectedAnswers: [] },
    });
    expect(judgeAnswer(withoutCollision, ' a b ')).toMatchObject({ kind: 'canonical', isCorrect: true });
  });
});
