import { describe, expect, it } from 'vitest';
import { TypewriterEngine, type MonotonicClock, type TimerScheduler } from '../../src/engine/typewriterEngine';

class FakeClock implements MonotonicClock {
  value = 0;
  now() { return this.value; }
}

class NullScheduler implements TimerScheduler {
  set(_callback: () => void, _delayMs: number) { return 0 as unknown as ReturnType<typeof setTimeout>; }
  clear(_handle: ReturnType<typeof setTimeout>) {}
}

describe('TypewriterEngine', () => {
  it('defines buzzIndex as committed grapheme count and includes commits due at buzz time', () => {
    const clock = new FakeClock();
    const engine = new TypewriterEngine('ABCDE', 100, clock, new NullScheduler());
    engine.start(() => undefined); // A committed at t=0
    clock.value = 200;
    const buzz = engine.buzz(); // B at 100, C at 200 are included
    expect(buzz.buzzIndex).toBe(3);
    expect(buzz.visibleText).toBe('ABC');
    expect(buzz.buzzRatio).toBeCloseTo(0.6);
    expect(buzz.buzzTimeMs).toBe(200);
  });

  it('does not commit graphemes scheduled after buzz', () => {
    const clock = new FakeClock();
    const engine = new TypewriterEngine('ABCDE', 100, clock, new NullScheduler());
    engine.start(() => undefined);
    clock.value = 199;
    expect(engine.buzz().buzzIndex).toBe(2);
  });
});
