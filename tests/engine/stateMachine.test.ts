import { describe, expect, it } from 'vitest';
import { transitionPhase } from '../../src/engine/stateMachine';

describe('quiz state machine', () => {
  it('uses reading -> answering on buzz', () => {
    expect(transitionPhase('reading', 'BUZZ', 'normal')).toBe('answering');
  });

  it('study skips reading and enters answering directly', () => {
    expect(transitionPhase('ready', 'START_READING', 'study')).toBe('answering');
  });

  it('rejects invalid transitions', () => {
    expect(() => transitionPhase('reading', 'SUBMIT', 'normal')).toThrow();
  });
});
