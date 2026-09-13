import { describe, expect, it } from 'vitest';
import type { BuzzSnapshot, KimariReference, QuizMode } from '../../src/domain/types';
import { createAttempt } from '../../src/engine/attemptFactory';
import {
  createModeSessionState,
  resolveModeAttempt,
  terminateModeSession,
} from '../../src/engine/modeSessionEngine';
import { makeQuestionV1 } from '../fixtures/questionV1';

const question = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1, prompt: 'abcdefghijklmnopqrst' });
const kimariReference: KimariReference = { questionId: 'q', revisionId: 'r1', referenceBuzzIndex: 12 };

function buzz(index: number): BuzzSnapshot {
  return {
    buzzIndex: index,
    totalGraphemeCount: 20,
    buzzRatio: index / 20,
    visibleText: question.prompt.slice(0, index),
    buzzTimeMs: index * 10,
    buzzAtMs: index * 10,
  };
}

let serial = 0;
function attempt(input: {
  mode: QuizMode;
  outcome: 'correct' | 'incorrect' | 'pass' | 'skip';
  buzz?: BuzzSnapshot | null;
  reference?: KimariReference | null;
}) {
  serial += 1;
  return createAttempt({
    attemptId: `a-${serial}`,
    question,
    sessionId: 's',
    mode: input.mode,
    outcome: input.outcome,
    judge: input.outcome === 'correct'
      ? { kind: 'canonical', isCorrect: true, normalizedSubmitted: 'answer', matchedAnswer: 'Answer' }
      : input.outcome === 'incorrect'
        ? { kind: 'incorrect', isCorrect: false, normalizedSubmitted: 'wrong', matchedAnswer: null }
        : null,
    submittedAnswer: input.outcome === 'correct' ? 'Answer' : input.outcome === 'incorrect' ? 'Wrong' : null,
    startedAt: '2026-09-14T00:00:00.000Z',
    completedAt: '2026-09-14T00:00:01.000Z',
    buzz: input.buzz ?? null,
    responseTimeMs: input.buzz === undefined || input.buzz === null ? null : 300,
    kimariReference: input.reference ?? null,
  });
}

describe('Kimari-ji deterministic vectors', () => {
  it('TV-K01 exact BUZZ persists delta 0 independently of correctness', () => {
    const value = attempt({ mode: 'kimari', outcome: 'correct', buzz: buzz(12), reference: kimariReference });
    expect(value.kimari).toEqual({ referenceBuzzIndex: 12, playerBuzzIndex: 12, deltaGraphemes: 0 });
    expect(value.isCorrect).toBe(true);
  });

  it('TV-K02 early BUZZ persists negative delta', () => {
    expect(attempt({ mode: 'kimari', outcome: 'correct', buzz: buzz(9), reference: kimariReference }).kimari?.deltaGraphemes).toBe(-3);
  });

  it('TV-K03 late BUZZ persists positive delta', () => {
    expect(attempt({ mode: 'kimari', outcome: 'correct', buzz: buzz(17), reference: kimariReference }).kimari?.deltaGraphemes).toBe(5);
  });

  it('TV-K04 wrong answer keeps Kimari delta and isCorrect=false', () => {
    const value = attempt({ mode: 'kimari', outcome: 'incorrect', buzz: buzz(12), reference: kimariReference });
    expect(value.kimari?.deltaGraphemes).toBe(0);
    expect(value.isCorrect).toBe(false);
  });

  it('TV-K05 Skip before BUZZ has null player/delta and consumes the question', () => {
    const state = createModeSessionState('kimari', 2);
    const value = attempt({ mode: 'kimari', outcome: 'skip', reference: kimariReference });
    const resolved = resolveModeAttempt(state, value);
    expect(value.kimari).toEqual({ referenceBuzzIndex: 12, playerBuzzIndex: null, deltaGraphemes: null });
    expect(value.isCorrect).toBeNull();
    expect(resolved.state.consumedQuestionCount).toBe(1);
    expect(resolved.continuation).toEqual({ type: 'NEXT_QUESTION' });
  });

  it('TV-K06 Pass before BUZZ has null BUZZ metrics and consumes the question', () => {
    const state = createModeSessionState('kimari', 2);
    const value = attempt({ mode: 'kimari', outcome: 'pass', reference: kimariReference });
    const resolved = resolveModeAttempt(state, value);
    expect(value.buzzIndex).toBeNull();
    expect(value.responseTimeMs).toBeNull();
    expect(resolved.state.consumedQuestionCount).toBe(1);
  });

  it('TV-K07 Pass after BUZZ preserves BUZZ/Kimari metrics with null response time', () => {
    const value = createAttempt({
      attemptId: 'k-post-pass',
      question,
      sessionId: 's',
      mode: 'kimari',
      outcome: 'pass',
      judge: null,
      submittedAnswer: null,
      startedAt: '2026-09-14T00:00:00.000Z',
      completedAt: '2026-09-14T00:00:01.000Z',
      buzz: buzz(15),
      responseTimeMs: null,
      kimariReference,
    });
    expect(value.buzzIndex).toBe(15);
    expect(value.kimari?.deltaGraphemes).toBe(3);
    expect(value.responseTimeMs).toBeNull();
  });

  it('TV-K08 final consumed question ends completed', () => {
    const state = createModeSessionState('kimari', 1);
    const resolved = resolveModeAttempt(state, attempt({ mode: 'kimari', outcome: 'correct', buzz: buzz(12), reference: kimariReference }));
    expect(resolved.state.endReason).toBe('completed');
    expect(resolved.state.modeResult).toEqual({ mode: 'kimari' });
    expect(resolved.continuation).toEqual({ type: 'END_SESSION', reason: 'completed' });
  });
});

describe('Survival deterministic vectors', () => {
  it('TV-S01 first incorrect fails with score 0', () => {
    const resolved = resolveModeAttempt(createModeSessionState('survival', 3), attempt({ mode: 'survival', outcome: 'incorrect', buzz: buzz(5) }));
    expect(resolved.state.score).toBe(0);
    expect(resolved.state.endReason).toBe('survival_failed');
    expect(resolved.state.modeResult).toMatchObject({ mode: 'survival', score: 0, cleared: false, failure: { cause: 'incorrect' } });
  });

  it('TV-S02 seven correct then incorrect fails at score 7', () => {
    let state = createModeSessionState('survival', 10);
    for (let index = 0; index < 7; index += 1) {
      state = resolveModeAttempt(state, attempt({ mode: 'survival', outcome: 'correct', buzz: buzz(5) })).state;
    }
    state = resolveModeAttempt(state, attempt({ mode: 'survival', outcome: 'incorrect', buzz: buzz(5) })).state;
    expect(state.score).toBe(7);
    expect(state.endReason).toBe('survival_failed');
  });

  it('TV-S03 four correct then Pass fails at score 4', () => {
    let state = createModeSessionState('survival', 10);
    for (let index = 0; index < 4; index += 1) {
      state = resolveModeAttempt(state, attempt({ mode: 'survival', outcome: 'correct', buzz: buzz(5) })).state;
    }
    state = resolveModeAttempt(state, attempt({ mode: 'survival', outcome: 'pass' })).state;
    expect(state.score).toBe(4);
    expect(state.modeResult).toMatchObject({ failure: { cause: 'pass' } });
  });

  it('TV-S04 Skip is forbidden', () => {
    expect(() => resolveModeAttempt(
      createModeSessionState('survival', 2),
      attempt({ mode: 'survival', outcome: 'skip' }),
    )).toThrow('Skip is forbidden');
  });

  it('TV-S05 Correct increments score once and continues while targets remain', () => {
    const resolved = resolveModeAttempt(createModeSessionState('survival', 2), attempt({ mode: 'survival', outcome: 'correct', buzz: buzz(5) }));
    expect(resolved.state.score).toBe(1);
    expect(resolved.state.consumedQuestionCount).toBe(1);
    expect(resolved.continuation).toEqual({ type: 'NEXT_QUESTION' });
  });

  it('TV-S06 all-target correct clears Survival', () => {
    let state = createModeSessionState('survival', 2);
    state = resolveModeAttempt(state, attempt({ mode: 'survival', outcome: 'correct', buzz: buzz(5) })).state;
    const final = resolveModeAttempt(state, attempt({ mode: 'survival', outcome: 'correct', buzz: buzz(5) }));
    expect(final.state.score).toBe(2);
    expect(final.state.endReason).toBe('survival_cleared');
    expect(final.state.modeResult).toEqual({ mode: 'survival', score: 2, cleared: true, failure: null });
  });

  it('TV-S07 Survival has no life field', () => {
    const state = createModeSessionState('survival', 2);
    expect('life' in state).toBe(false);
    expect(state.modeResult).toEqual({ mode: 'survival', score: 0, cleared: false, failure: null });
  });

  it('TV-S08 user end preserves current score without failure', () => {
    let state = createModeSessionState('survival', 3);
    state = resolveModeAttempt(state, attempt({ mode: 'survival', outcome: 'correct', buzz: buzz(5) })).state;
    state = terminateModeSession(state, 'user_ended');
    expect(state.endReason).toBe('user_ended');
    expect(state.modeResult).toEqual({ mode: 'survival', score: 1, cleared: false, failure: null });
  });

  it('TV-S09 fatal error terminates without manufacturing a failure cause', () => {
    const state = terminateModeSession(createModeSessionState('survival', 3), 'fatal_error');
    expect(state.endReason).toBe('fatal_error');
    expect(state.modeResult).toEqual({ mode: 'survival', score: 0, cleared: false, failure: null });
  });

  it('TV-S10 attempts after termination are rejected', () => {
    const ended = terminateModeSession(createModeSessionState('survival', 3), 'user_ended');
    expect(() => resolveModeAttempt(ended, attempt({ mode: 'survival', outcome: 'correct', buzz: buzz(5) }))).toThrow('already ended');
  });

  it('TV-S11 each resolved Attempt increments consumedQuestionCount exactly once', () => {
    const state = createModeSessionState('survival', 3);
    const next = resolveModeAttempt(state, attempt({ mode: 'survival', outcome: 'correct', buzz: buzz(5) })).state;
    expect(state.consumedQuestionCount).toBe(0);
    expect(next.consumedQuestionCount).toBe(1);
  });

  it('TV-S12 incorrect does not increment score', () => {
    let state = createModeSessionState('survival', 3);
    state = resolveModeAttempt(state, attempt({ mode: 'survival', outcome: 'correct', buzz: buzz(5) })).state;
    state = resolveModeAttempt(state, attempt({ mode: 'survival', outcome: 'incorrect', buzz: buzz(5) })).state;
    expect(state.score).toBe(1);
  });
});
