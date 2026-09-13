import type {
  KimariSessionResult,
  PersistedAttempt,
  QuizMode,
  SessionEndReason,
  SessionModeResult,
  SurvivalSessionResult,
} from '../domain/types';

export type CompetitiveMode = 'kimari' | 'survival';

export interface ModeSessionState {
  readonly mode: CompetitiveMode;
  readonly targetQuestionCount: number;
  readonly consumedQuestionCount: number;
  readonly score: number;
  readonly endReason: SessionEndReason | null;
  readonly modeResult: SessionModeResult;
}

export type ModeContinuation =
  | { readonly type: 'NEXT_QUESTION' }
  | { readonly type: 'END_SESSION'; readonly reason: SessionEndReason };

export interface ModeResolution {
  readonly state: ModeSessionState;
  readonly continuation: ModeContinuation;
}

function initialModeResult(mode: CompetitiveMode): KimariSessionResult | SurvivalSessionResult {
  return mode === 'kimari'
    ? { mode: 'kimari' }
    : { mode: 'survival', score: 0, cleared: false, failure: null };
}

export function createModeSessionState(mode: CompetitiveMode, targetQuestionCount: number): ModeSessionState {
  if (!Number.isInteger(targetQuestionCount) || targetQuestionCount < 1) {
    throw new Error(`${mode} session requires a non-empty fixed question plan`);
  }
  return {
    mode,
    targetQuestionCount,
    consumedQuestionCount: 0,
    score: 0,
    endReason: null,
    modeResult: initialModeResult(mode),
  };
}

function assertActive(state: ModeSessionState): void {
  if (state.endReason !== null) throw new Error(`Session already ended: ${state.endReason}`);
  if (state.consumedQuestionCount >= state.targetQuestionCount) {
    throw new Error('Session has no unresolved target questions');
  }
}

function assertAttemptBelongsToMode(state: ModeSessionState, attempt: PersistedAttempt): void {
  if (attempt.mode !== state.mode) throw new Error(`Attempt mode ${attempt.mode} does not match session mode ${state.mode}`);
  if (attempt.outcome === 'aborted') throw new Error('aborted Attempt is only valid for explicit session termination');
  if (state.mode === 'kimari' && attempt.kimari === null) throw new Error('Kimari Attempt requires persisted Kimari metrics');
}

function resolveKimari(state: ModeSessionState, _attempt: PersistedAttempt): ModeResolution {
  const consumedQuestionCount = state.consumedQuestionCount + 1;
  if (consumedQuestionCount === state.targetQuestionCount) {
    const modeResult: KimariSessionResult = { mode: 'kimari' };
    return {
      state: {
        ...state,
        consumedQuestionCount,
        endReason: 'completed',
        modeResult,
      },
      continuation: { type: 'END_SESSION', reason: 'completed' },
    };
  }
  return {
    state: { ...state, consumedQuestionCount },
    continuation: { type: 'NEXT_QUESTION' },
  };
}

function resolveSurvival(state: ModeSessionState, attempt: PersistedAttempt): ModeResolution {
  if (attempt.outcome === 'skip') throw new Error('Skip is forbidden in Survival');

  const consumedQuestionCount = state.consumedQuestionCount + 1;

  if (attempt.outcome === 'incorrect' || attempt.outcome === 'pass') {
    const modeResult: SurvivalSessionResult = {
      mode: 'survival',
      score: state.score,
      cleared: false,
      failure: {
        failedAttemptId: attempt.attemptId,
        cause: attempt.outcome,
      },
    };
    return {
      state: {
        ...state,
        consumedQuestionCount,
        endReason: 'survival_failed',
        modeResult,
      },
      continuation: { type: 'END_SESSION', reason: 'survival_failed' },
    };
  }

  if (attempt.outcome !== 'correct' || attempt.isCorrect !== true) {
    throw new Error(`Invalid Survival scored outcome: ${attempt.outcome}`);
  }

  const score = state.score + 1;
  if (consumedQuestionCount === state.targetQuestionCount) {
    const modeResult: SurvivalSessionResult = {
      mode: 'survival',
      score,
      cleared: true,
      failure: null,
    };
    return {
      state: {
        ...state,
        consumedQuestionCount,
        score,
        endReason: 'survival_cleared',
        modeResult,
      },
      continuation: { type: 'END_SESSION', reason: 'survival_cleared' },
    };
  }

  const modeResult: SurvivalSessionResult = {
    mode: 'survival',
    score,
    cleared: false,
    failure: null,
  };
  return {
    state: {
      ...state,
      consumedQuestionCount,
      score,
      modeResult,
    },
    continuation: { type: 'NEXT_QUESTION' },
  };
}

export function resolveModeAttempt(state: ModeSessionState, attempt: PersistedAttempt): ModeResolution {
  assertActive(state);
  assertAttemptBelongsToMode(state, attempt);
  return state.mode === 'kimari' ? resolveKimari(state, attempt) : resolveSurvival(state, attempt);
}

export function terminateModeSession(
  state: ModeSessionState,
  reason: Extract<SessionEndReason, 'user_ended' | 'fatal_error'>,
): ModeSessionState {
  if (state.endReason !== null) return state;
  const modeResult: SessionModeResult = state.mode === 'kimari'
    ? { mode: 'kimari' }
    : {
        mode: 'survival',
        score: state.score,
        cleared: false,
        failure: null,
      };
  return { ...state, endReason: reason, modeResult };
}

export function isCompetitiveMode(mode: QuizMode): mode is CompetitiveMode {
  return mode === 'kimari' || mode === 'survival';
}
