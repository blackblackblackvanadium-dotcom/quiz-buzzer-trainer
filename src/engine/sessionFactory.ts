import type {
  QuizMode,
  QuizSession,
  SessionEndReason,
  SessionId,
  SessionModeResult,
} from '../domain/types';

function epochMs(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp`);
  return parsed;
}

export function createSessionRecord(input: {
  readonly sessionId: SessionId;
  readonly mode: QuizMode;
  readonly startedAt: string;
  readonly targetQuestionCount: number;
  readonly modeResult?: SessionModeResult;
}): QuizSession {
  if (!Number.isInteger(input.targetQuestionCount) || input.targetQuestionCount < 0) {
    throw new Error('targetQuestionCount must be a non-negative integer');
  }
  return {
    sessionId: input.sessionId,
    mode: input.mode,
    startedAtEpochMs: epochMs(input.startedAt, 'startedAt'),
    endedAtEpochMs: null,
    endReason: null,
    targetQuestionCount: input.targetQuestionCount,
    consumedQuestionCount: 0,
    modeResult: input.modeResult ?? null,
    startedAt: input.startedAt,
    endedAt: null,
  };
}

export function updateSessionProgress(
  session: QuizSession,
  consumedQuestionCount: number,
  modeResult: SessionModeResult,
): QuizSession {
  if (!Number.isInteger(consumedQuestionCount) || consumedQuestionCount < 0 || consumedQuestionCount > session.targetQuestionCount) {
    throw new Error('consumedQuestionCount is outside the fixed Session plan');
  }
  if (session.endReason !== null) throw new Error(`Session already ended: ${session.endReason}`);
  return { ...session, consumedQuestionCount, modeResult };
}

export function endSessionRecord(
  session: QuizSession,
  reason: SessionEndReason,
  endedAt: string,
  options: {
    readonly consumedQuestionCount?: number;
    readonly modeResult?: SessionModeResult;
  } = {},
): QuizSession {
  const endedAtEpochMs = epochMs(endedAt, 'endedAt');
  if (endedAtEpochMs < session.startedAtEpochMs) throw new Error('endedAt must not precede startedAt');
  const consumedQuestionCount = options.consumedQuestionCount ?? session.consumedQuestionCount;
  if (!Number.isInteger(consumedQuestionCount) || consumedQuestionCount < 0 || consumedQuestionCount > session.targetQuestionCount) {
    throw new Error('consumedQuestionCount is outside the fixed Session plan');
  }
  return {
    ...session,
    endedAtEpochMs,
    endReason: reason,
    consumedQuestionCount,
    modeResult: options.modeResult === undefined ? session.modeResult : options.modeResult,
    endedAt,
  };
}
