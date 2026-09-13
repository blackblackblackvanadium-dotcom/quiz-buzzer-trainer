import { describe, expect, it } from 'vitest';
import { transitionPhase } from '../../src/engine/stateMachine';

describe('quiz state machine', () => {
  it('uses reading -> answering on buzz', () => {
    expect(transitionPhase('reading', 'BUZZ', 'normal')).toBe('answering');
  });

  it('study skips reading and enters answering directly', () => {
    expect(transitionPhase('ready', 'START_READING', 'study')).toBe('answering');
  });

  it('allows Pass before and after BUZZ', () => {
    expect(transitionPhase('reading', 'PASS', 'kimari')).toBe('result');
    expect(transitionPhase('answering', 'PASS', 'kimari')).toBe('result');
    expect(transitionPhase('answering', 'PASS', 'survival')).toBe('result');
  });

  it('allows Skip only before BUZZ and forbids it in Survival', () => {
    expect(transitionPhase('reading', 'SKIP', 'kimari')).toBe('result');
    expect(() => transitionPhase('answering', 'SKIP', 'kimari')).toThrow('Invalid quiz transition');
    expect(() => transitionPhase('reading', 'SKIP', 'survival')).toThrow('Skip is forbidden');
  });

  it('keeps Normal/Review BUZZ transitions unchanged', () => {
    expect(transitionPhase('reading', 'BUZZ', 'normal')).toBe('answering');
    expect(transitionPhase('reading', 'BUZZ', 'review')).toBe('answering');
  });

  it('rejects invalid transitions', () => {
    expect(() => transitionPhase('reading', 'SUBMIT', 'normal')).toThrow();
  });
});
