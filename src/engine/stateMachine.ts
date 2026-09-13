import type { QuizMode, QuizPhase } from '../domain/types';

export type QuizEvent =
  | 'LOAD'
  | 'READY'
  | 'START_READING'
  | 'BUZZ'
  | 'PASS'
  | 'SKIP'
  | 'SUBMIT'
  | 'NEXT'
  | 'FINISH';

const commonTransitions: Readonly<Record<QuizPhase, Partial<Record<QuizEvent, QuizPhase>>>> = {
  loading: { READY: 'ready' },
  ready: { START_READING: 'reading', FINISH: 'finished' },
  reading: { BUZZ: 'answering', PASS: 'result', SKIP: 'result', FINISH: 'finished' },
  answering: { PASS: 'result', SUBMIT: 'result', FINISH: 'finished' },
  result: { NEXT: 'loading', FINISH: 'finished' },
  finished: {},
};

export function transitionPhase(phase: QuizPhase, event: QuizEvent, mode: QuizMode): QuizPhase {
  if (mode === 'study' && phase === 'ready' && event === 'START_READING') {
    return 'answering';
  }
  if (mode === 'survival' && event === 'SKIP') {
    throw new Error('Skip is forbidden in Survival');
  }
  const next = commonTransitions[phase][event];
  if (next === undefined) {
    throw new Error(`Invalid quiz transition: ${phase} --${event}--> ? (${mode})`);
  }
  return next;
}
