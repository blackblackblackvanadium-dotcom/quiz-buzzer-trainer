import { describe, expect, it } from 'vitest';
import { createSessionRecord, endSessionRecord, updateSessionProgress } from '../../src/engine/sessionFactory';

describe('P0 #6 Session lifecycle invariants', () => {
  it('creates an active Session with no terminal markers', () => {
    const session = createSessionRecord({
      sessionId: 's-active',
      mode: 'normal',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 2,
    });

    expect(session).toEqual({
      sessionId: 's-active',
      mode: 'normal',
      startedAtEpochMs: Date.parse('2026-09-14T00:00:00.000Z'),
      endedAtEpochMs: null,
      endReason: null,
      targetQuestionCount: 2,
      consumedQuestionCount: 0,
      modeResult: null,
      startedAt: '2026-09-14T00:00:00.000Z',
      endedAt: null,
    });
  });

  it('allows interrupted termination before exhaustion and keeps endedAt aliases aligned', () => {
    const session = createSessionRecord({
      sessionId: 's-interrupted',
      mode: 'normal',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 3,
    });
    const progressed = updateSessionProgress(session, 1, null);
    const ended = endSessionRecord(progressed, 'user_ended', '2026-09-14T00:00:05.000Z');

    expect(ended.endReason).toBe('user_ended');
    expect(ended.consumedQuestionCount).toBe(1);
    expect(ended.endedAt).toBe('2026-09-14T00:00:05.000Z');
    expect(ended.endedAtEpochMs).toBe(Date.parse('2026-09-14T00:00:05.000Z'));
  });

  it('requires natural completion to exhaust the fixed Session plan', () => {
    const session = createSessionRecord({
      sessionId: 's-complete',
      mode: 'normal',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 2,
    });
    const progressed = updateSessionProgress(session, 1, null);

    expect(() => endSessionRecord(
      progressed,
      'completed',
      '2026-09-14T00:00:02.000Z',
      { consumedQuestionCount: 1 },
    )).toThrow('requires the fixed Session plan to be exhausted');

    const completed = endSessionRecord(
      progressed,
      'completed',
      '2026-09-14T00:00:03.000Z',
      { consumedQuestionCount: 2 },
    );
    expect(completed).toMatchObject({
      endReason: 'completed',
      consumedQuestionCount: 2,
      endedAt: '2026-09-14T00:00:03.000Z',
      endedAtEpochMs: Date.parse('2026-09-14T00:00:03.000Z'),
    });
  });

  it('rejects progress or a second termination after any terminal marker exists', () => {
    const session = createSessionRecord({
      sessionId: 's-terminal',
      mode: 'normal',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 1,
    });
    const ended = endSessionRecord(
      session,
      'completed',
      '2026-09-14T00:00:01.000Z',
      { consumedQuestionCount: 1 },
    );

    expect(() => updateSessionProgress(ended, 1, null)).toThrow('Session already ended');
    expect(() => endSessionRecord(ended, 'user_ended', '2026-09-14T00:00:02.000Z')).toThrow('Session already ended');

    const legacyTerminal = {
      ...session,
      endedAt: '2026-09-14T00:00:01.000Z',
      endedAtEpochMs: Date.parse('2026-09-14T00:00:01.000Z'),
    };
    expect(() => updateSessionProgress(legacyTerminal, 1, null)).toThrow('Session already ended');
    expect(() => endSessionRecord(legacyTerminal, 'user_ended', '2026-09-14T00:00:02.000Z')).toThrow('Session already ended');
  });

  it('rejects Survival-only end reasons on non-Survival Sessions', () => {
    const session = createSessionRecord({
      sessionId: 's-normal',
      mode: 'normal',
      startedAt: '2026-09-14T00:00:00.000Z',
      targetQuestionCount: 1,
    });

    expect(() => endSessionRecord(
      session,
      'survival_cleared',
      '2026-09-14T00:00:01.000Z',
      { consumedQuestionCount: 1 },
    )).toThrow('only valid for Survival sessions');
  });
});
