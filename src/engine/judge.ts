import type { JudgeResult, QuestionRevision } from '../domain/types';

const ORDINARY_SEPARATOR_OR_PUNCTUATION = /[\s\p{Z}\p{P}]+/gu;

export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .trim()
    .replace(ORDINARY_SEPARATOR_OR_PUNCTUATION, '');
}

export function judgeAnswer(question: QuestionRevision, submitted: string): JudgeResult {
  const normalizedSubmitted = normalizeAnswer(submitted);

  const rejected = question.rejectedAnswers.find(
    (answer) => normalizeAnswer(answer) === normalizedSubmitted,
  );
  if (rejected !== undefined) {
    return {
      kind: 'rejected',
      isCorrect: false,
      normalizedSubmitted,
      matchedAnswer: rejected,
    };
  }

  if (normalizeAnswer(question.canonicalAnswer) === normalizedSubmitted) {
    return {
      kind: 'canonical',
      isCorrect: true,
      normalizedSubmitted,
      matchedAnswer: question.canonicalAnswer,
    };
  }

  const acceptable = question.acceptableAnswers.find(
    (answer) => normalizeAnswer(answer) === normalizedSubmitted,
  );
  if (acceptable !== undefined) {
    return {
      kind: 'acceptable',
      isCorrect: true,
      normalizedSubmitted,
      matchedAnswer: acceptable,
    };
  }

  return {
    kind: 'incorrect',
    isCorrect: false,
    normalizedSubmitted,
    matchedAnswer: null,
  };
}
