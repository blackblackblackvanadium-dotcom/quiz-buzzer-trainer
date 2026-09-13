import { describe, expect, it } from 'vitest';
import { parseQuestionRevision } from '../../src/data/validation';

const valid = {
  questionId: 'q', revisionId: 'r1', prompt: 'p', canonicalAnswer: 'a', acceptableAnswers: [], rejectedAnswers: [],
  category: 'c', pattern: 'p', difficulty: 1, tags: [], createdAt: '2026-01-01T00:00:00Z',
};

describe('question runtime validation', () => {
  it('accepts a valid QuestionRevision', () => {
    expect(parseQuestionRevision(valid).revisionId).toBe('r1');
  });

  it('rejects malformed imported questions', () => {
    expect(() => parseQuestionRevision({ ...valid, acceptableAnswers: 'x' })).toThrow();
  });
});
