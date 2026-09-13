import { describe, expect, it } from 'vitest';
import { TypewriterEngine, type MonotonicClock, type TimerScheduler } from '../../src/engine/typewriterEngine';

class FakeClock implements MonotonicClock {
  value = 0;
  now() { return this.value; }
}

type TimerHandle = ReturnType<typeof setTimeout>;

interface TimerEntry {
  readonly callback: () => void;
  readonly delayMs: number;
  cleared: boolean;
}

class ManualScheduler implements TimerScheduler {
  readonly entries: TimerEntry[] = [];

  set(callback: () => void, delayMs: number): TimerHandle {
    this.entries.push({ callback, delayMs, cleared: false });
    return this.entries.length as unknown as TimerHandle;
  }

  clear(handle: TimerHandle): void {
    const entry = this.entries[(handle as unknown as number) - 1];
    if (entry !== undefined) entry.cleared = true;
  }

  fire(index: number, evenIfCleared = false): void {
    const entry = this.entries[index];
    if (entry === undefined) throw new Error(`Missing timer ${index}`);
    if (entry.cleared && !evenIfCleared) return;
    entry.callback();
  }
}

function setup(text = 'ABCDE', intervalMs = 100) {
  const clock = new FakeClock();
  const scheduler = new ManualScheduler();
  const commits: number[] = [];
  const engine = new TypewriterEngine(text, intervalMs, clock, scheduler);
  engine.start((snapshot) => commits.push(snapshot.committedCount));
  return { clock, scheduler, commits, engine };
}

describe('TypewriterEngine BUZZ semantics', () => {
  it('uses actual presentation commits when commitAt < buzzAt', () => {
    const { clock, scheduler, engine } = setup();
    clock.value = 100;
    scheduler.fire(0); // actual A commit at t=100
    clock.value = 101;

    const buzz = engine.buzz();

    expect(buzz.buzzIndex).toBe(1);
    expect(buzz.visibleText).toBe('A');
  });

  it('includes a commit that actually completed before BUZZ at the same timestamp', () => {
    const { clock, scheduler, engine } = setup();
    clock.value = 100;
    scheduler.fire(0); // commit executes first at t=100

    const buzz = engine.buzz(); // BUZZ handler then starts at t=100

    expect(buzz.buzzIndex).toBe(1);
    expect(buzz.buzzTimeMs).toBe(100);
  });

  it('excludes a scheduled commit when buzzAt < commitAt', () => {
    const { clock, scheduler, engine } = setup();
    clock.value = 99;

    const buzz = engine.buzz();

    expect(buzz.buzzIndex).toBe(0);
    clock.value = 100;
    scheduler.fire(0, true); // simulate stale callback after BUZZ
    expect(engine.getSnapshot().committedCount).toBe(0);
  });

  it('excludes a same-timestamp callback that executes after the BUZZ handler starts', () => {
    const { clock, scheduler, engine } = setup();
    clock.value = 100;

    const buzz = engine.buzz();
    scheduler.fire(0, true); // same clock value, but callback happens after BUZZ

    expect(buzz.buzzIndex).toBe(0);
    expect(engine.getSnapshot().committedCount).toBe(0);
  });

  it('never catches up due-but-not-executed timers during BUZZ', () => {
    const { clock, engine } = setup();
    clock.value = 500; // five intervals elapsed, but no timer callback executed

    const buzz = engine.buzz();

    expect(buzz.buzzIndex).toBe(0);
    expect(buzz.visibleText).toBe('');
    expect(buzz.buzzRatio).toBe(0);
  });

  it('a delayed timer commits exactly one grapheme and schedules the next full interval', () => {
    const { clock, scheduler, commits, engine } = setup();
    clock.value = 350; // first 100ms timer executes very late
    scheduler.fire(0);

    expect(engine.getSnapshot().committedCount).toBe(1);
    expect(commits).toEqual([1]);
    expect(scheduler.entries).toHaveLength(2);
    expect(scheduler.entries[1]?.delayMs).toBe(100);
    expect(engine.buzz().buzzIndex).toBe(1);
  });

  it('prevents stale callbacks from committing after BUZZ', () => {
    const { clock, scheduler, engine } = setup();
    clock.value = 100;
    scheduler.fire(0); // A committed; timer 1 now waits for B
    clock.value = 150;
    expect(engine.buzz().buzzIndex).toBe(1);

    clock.value = 250;
    scheduler.fire(1, true); // forcibly execute callback even though pause cleared it

    expect(engine.getSnapshot()).toMatchObject({ committedCount: 1, text: 'A' });
  });

  it('supports buzzIndex 0 and buzzRatio 0 before the first actual commit', () => {
    const { engine } = setup('AB');

    const buzz = engine.buzz(0);

    expect(buzz.buzzIndex).toBe(0);
    expect(buzz.totalGraphemeCount).toBe(2);
    expect(buzz.buzzRatio).toBe(0);
  });

  it('supports buzzIndex N and buzzRatio 1 after all graphemes actually commit', () => {
    const { clock, scheduler, engine } = setup('AB');
    clock.value = 100;
    scheduler.fire(0);
    clock.value = 200;
    scheduler.fire(1);

    const buzz = engine.buzz();

    expect(buzz.buzzIndex).toBe(2);
    expect(buzz.totalGraphemeCount).toBe(2);
    expect(buzz.buzzRatio).toBe(1);
    expect(buzz.visibleText).toBe('AB');
  });

  it('calculates intermediate buzzRatio from actual committed count', () => {
    const { clock, scheduler, engine } = setup('ABCD');
    clock.value = 100;
    scheduler.fire(0);
    clock.value = 200;
    scheduler.fire(1);

    const buzz = engine.buzz();

    expect(buzz.buzzIndex).toBe(2);
    expect(buzz.buzzRatio).toBe(0.5);
  });
});
