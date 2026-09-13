import type {
  Attempt,
  AttemptId,
  AttemptOutcome,
  BuzzSnapshot,
  JudgeResult,
  QuestionRevision,
  QuizMode,
  SessionId,
} from '../domain/types';

export interface CreateAttemptInput {
  readonly attemptId: AttemptId;
  readonly question: QuestionRevision;
  readonly sessionId: SessionId;
  readonly mode: QuizMode;
  readonly outcome: AttemptOutcome;
  readonly judge: JudgeResult | null;
  readonly submittedAnswer: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly buzz: BuzzSnapshot | null;
  readonly responseTimeMs: number | null;
}

export function createAttempt(input: CreateAttemptInput): Attempt {
  return Object.freeze({
    attemptId: input.attemptId,
    questionId: input.question.questionId,
    revisionId: input.question.revisionId,
    sessionId: input.sessionId,
    mode: input.mode,
    outcome: input.outcome,
    judgeKind: input.judge?.kind ?? null,
    submittedAnswer: input.submittedAnswer,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    buzzIndex: input.buzz?.buzzIndex ?? null,
    buzzRatio: input.buzz?.buzzRatio ?? null,
    buzzTimeMs: input.buzz?.buzzTimeMs ?? null,
    responseTimeMs: input.responseTimeMs,
    visibleTextAtBuzz: input.buzz?.visibleText ?? null,
  });
}
