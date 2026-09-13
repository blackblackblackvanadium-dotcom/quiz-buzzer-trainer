import type { Attempt, QuestionRevision, StudyState } from '../domain/types';

const DAY_MS = 86_400_000;

export function initialStudyState(question: QuestionRevision, now: Date): StudyState {
  return {
    questionId: question.questionId,
    revisionId: question.revisionId,
    dueAt: now.toISOString(),
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
    bestBuzzIndex: null,
    bestBuzzRatio: null,
    bestResponseTimeMs: null,
    correctCount: 0,
    attemptCount: 0,
    streak: 0,
  };
}

export function updateStudyState(previous: StudyState, attempt: Attempt, now: Date): StudyState {
  const correct = attempt.outcome === 'correct';
  const lateCorrect = correct && attempt.buzzRatio !== null && attempt.buzzRatio > 0.8;
  const slowCorrect = correct && attempt.responseTimeMs !== null && attempt.responseTimeMs > 5_000;
  const quality = correct ? (lateCorrect || slowCorrect ? 3 : 5) : 1;

  const easeFactor = Math.max(
    1.3,
    previous.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  let repetitions = previous.repetitions;
  let intervalDays: number;
  if (!correct) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(previous.intervalDays * easeFactor));
  }

  return {
    ...previous,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS).toISOString(),
    intervalDays,
    easeFactor,
    repetitions,
    lapses: previous.lapses + (correct ? 0 : 1),
    bestBuzzIndex:
      attempt.buzzIndex === null
        ? previous.bestBuzzIndex
        : previous.bestBuzzIndex === null
          ? attempt.buzzIndex
          : Math.min(previous.bestBuzzIndex, attempt.buzzIndex),
    bestBuzzRatio:
      attempt.buzzRatio === null
        ? previous.bestBuzzRatio
        : previous.bestBuzzRatio === null
          ? attempt.buzzRatio
          : Math.min(previous.bestBuzzRatio, attempt.buzzRatio),
    bestResponseTimeMs:
      attempt.responseTimeMs === null
        ? previous.bestResponseTimeMs
        : previous.bestResponseTimeMs === null
          ? attempt.responseTimeMs
          : Math.min(previous.bestResponseTimeMs, attempt.responseTimeMs),
    correctCount: previous.correctCount + (correct ? 1 : 0),
    attemptCount: previous.attemptCount + 1,
    streak: correct ? previous.streak + 1 : 0,
  };
}
