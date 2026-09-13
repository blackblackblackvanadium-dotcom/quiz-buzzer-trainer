import { describe, expect, it } from 'vitest';
import { TypewriterEngine, type MonotonicClock, type TimerScheduler } from '../../src/engine/typewriterEngine';

class FakeClock implements MonotonicClock {
  value = 0;
  now() { return this.value; }
}

class NullScheduler implements TimerScheduler {
  set(_callback: () => void, _delayMs: number) {
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }
  clear(_handle: ReturnType<typeof setTimeout>) {}
}

function setup() {
  const clock = new FakeClock();
  const engine = new TypewriterEngine('ABCDE', 100, clock, new NullScheduler());
  engine.start(() => undefined);
  return { clock, engine };
}

describe('TypewriterEngine response timing authority', () => {
  it('measures BUZZ acceptance to answer submit confirmation with the injected monotonic clock', () => {
    const { clock, engine } = setup();
    clock.value = 125;
    engine.buzz();
    clock.value = 425;

    expect(engine.confirmAnswerSubmit()).toBe(300);
  });

  it('returns zero when BUZZ and submit confirmation occur at the same monotonic time', () => {
    const { clock, engine } = setup();
    clock.value = 250;
    engine.buzz();

    expect(engine.confirmAnswerSubmit()).toBe(0);
  });

  it('preserves delayed submit duration exactly', () => {
    const { clock, engine } = setup();
    clock.value = 10;
    engine.buzz();
    clock.value = 5_010;

    expect(engine.confirmAnswerSubmit()).toBe(5_000);
  });

  it('rejects multiple answer submit confirmations', () => {
    const { clock, engine } = setup();
    clock.value = 100;
    engine.buzz();
    clock.value = 175;

    expect(engine.confirmAnswerSubmit()).toBe(75);
    clock.value = 200;
    expect(() => engine.confirmAnswerSubmit()).toThrow('already been confirmed');
  });

  it('rejects answer submit confirmation before BUZZ acceptance', () => {
    const { engine } = setup();

    expect(() => engine.confirmAnswerSubmit()).toThrow('before BUZZ is accepted');
  });

  it('rejects a backwards clock value without consuming the valid submit confirmation', () => {
    const { clock, engine } = setup();
    clock.value = 500;
    engine.buzz();
    clock.value = 499;

    expect(() => engine.confirmAnswerSubmit()).toThrow('Monotonic clock moved backwards');

    clock.value = 550;
    expect(engine.confirmAnswerSubmit()).toBe(50);
  });
});
