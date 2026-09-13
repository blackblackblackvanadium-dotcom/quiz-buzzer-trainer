import type {
  AttemptId,
  AttemptOutcome,
  BuzzSnapshot,
  JudgeResult,
  KimariMetrics,
  KimariReference,
  PersistedAttempt,
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
  readonly kimariReference?: KimariReference | null;
}

function isCorrectForOutcome(outcome: AttemptOutcome): boolean | null {
  if (outcome === 'correct') return true;
  if (outcome === 'incorrect') return false;
  return null;
}

function toEpochMs(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp`);
  return parsed;
}

function buildKimariMetrics(
  mode: QuizMode,
  reference: KimariReference | null | undefined,
  buzz: BuzzSnapshot | null,
): KimariMetrics | null {
  if (mode !== 'kimari') return null;
  if (reference === null || reference === undefined) throw new Error('Kimari Attempt requires a KimariReference');
  const playerBuzzIndex = buzz?.buzzIndex ?? null;
  return {
    referenceBuzzIndex: reference.referenceBuzzIndex,
    playerBuzzIndex,
    deltaGraphemes: playerBuzzIndex === null ? null : playerBuzzIndex - reference.referenceBuzzIndex,
  };
}

export function createAttempt(input: CreateAttemptInput): PersistedAttempt {
  const startedAtEpochMs = toEpochMs(input.startedAt, 'startedAt');
  const completedAtEpochMs = toEpochMs(input.completedAt, 'completedAt');
  if (completedAtEpochMs < startedAtEpochMs) throw new Error('completedAt must not precede startedAt');

  return Object.freeze({
    attemptId: input.attemptId,
    questionId: input.question.questionId,
    revisionId: input.question.revisionId,
    sessionId: input.sessionId,
    mode: input.mode,
    outcome: input.outcome,
    isCorrect: isCorrectForOutcome(input.outcome),
    startedAtEpochMs,
    completedAtEpochMs,
    buzzIndex: input.buzz?.buzzIndex ?? null,
    totalGraphemeCount: input.buzz?.totalGraphemeCount ?? null,
    buzzRatio: input.buzz?.buzzRatio ?? null,
    buzzTimeMs: input.buzz?.buzzTimeMs ?? null,
    responseTimeMs: input.responseTimeMs,
    kimari: buildKimariMetrics(input.mode, input.kimariReference, input.buzz),
    judgeKind: input.judge?.kind ?? null,
    submittedAnswer: input.submittedAnswer,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    visibleTextAtBuzz: input.buzz?.visibleText ?? null,
  });
}
