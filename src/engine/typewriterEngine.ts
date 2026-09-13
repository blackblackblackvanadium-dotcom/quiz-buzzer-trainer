import type { BuzzSnapshot } from '../domain/types';
import { splitGraphemes, visibleText } from './grapheme';

export interface MonotonicClock {
  now(): number;
}

export interface TimerScheduler {
  set(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clear(handle: ReturnType<typeof setTimeout>): void;
}

const browserClock: MonotonicClock = { now: () => performance.now() };
const browserScheduler: TimerScheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle),
};

export interface TypewriterSnapshot {
  readonly committedCount: number;
  readonly totalGraphemeCount: number;
  readonly text: string;
  readonly complete: boolean;
}

export class TypewriterEngine {
  readonly graphemes: readonly string[];
  readonly intervalMs: number;

  private committedCount = 0;
  private firstCommitAtMs: number | null = null;
  private nextDueAtMs: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = true;
  private onCommit: ((snapshot: TypewriterSnapshot) => void) | null = null;

  constructor(
    text: string,
    intervalMs: number,
    private readonly clock: MonotonicClock = browserClock,
    private readonly scheduler: TimerScheduler = browserScheduler,
  ) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('intervalMs must be a positive finite number');
    }
    this.graphemes = splitGraphemes(text);
    this.intervalMs = intervalMs;
  }

  start(onCommit: (snapshot: TypewriterSnapshot) => void): void {
    if (!this.paused || this.firstCommitAtMs !== null) {
      throw new Error('TypewriterEngine can only be started once');
    }
    this.onCommit = onCommit;
    this.paused = false;

    if (this.graphemes.length === 0) {
      this.onCommit(this.snapshot());
      return;
    }

    const now = this.clock.now();
    this.firstCommitAtMs = now;
    this.commitOne();
    this.scheduleFrom(now + this.intervalMs);
  }

  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  getSnapshot(): TypewriterSnapshot {
    return this.snapshot();
  }

  /**
   * Deterministic BUZZ rule: every grapheme whose scheduled commit time is
   * <= buzzAtMs is committed before the BUZZ snapshot is taken.
   */
  buzz(buzzAtMs = this.clock.now()): BuzzSnapshot {
    if (this.firstCommitAtMs === null) {
      throw new Error('Cannot BUZZ before reading starts');
    }
    this.flushScheduledCommitsThrough(buzzAtMs);
    this.pause();

    const totalGraphemeCount = this.graphemes.length;
    const buzzIndex = this.committedCount;
    return {
      buzzIndex,
      totalGraphemeCount,
      buzzRatio: totalGraphemeCount === 0 ? 0 : buzzIndex / totalGraphemeCount,
      visibleText: visibleText(this.graphemes, buzzIndex),
      buzzTimeMs: Math.max(0, buzzAtMs - this.firstCommitAtMs),
      buzzAtMs,
    };
  }

  private scheduleFrom(dueAtMs: number): void {
    if (this.paused || this.committedCount >= this.graphemes.length) {
      this.nextDueAtMs = null;
      return;
    }
    this.nextDueAtMs = dueAtMs;
    const delayMs = Math.max(0, dueAtMs - this.clock.now());
    this.clearTimer();
    this.timer = this.scheduler.set(() => {
      this.timer = null;
      if (this.paused || this.nextDueAtMs === null) return;
      const due = this.nextDueAtMs;
      this.flushScheduledCommitsThrough(this.clock.now());
      if (!this.paused && this.committedCount < this.graphemes.length) {
        const next = this.nextDueAtMs ?? due + this.intervalMs;
        this.scheduleFrom(next);
      }
    }, delayMs);
  }

  private flushScheduledCommitsThrough(atMs: number): void {
    if (this.paused || this.nextDueAtMs === null) return;
    let due = this.nextDueAtMs;
    while (due <= atMs && this.committedCount < this.graphemes.length) {
      this.commitOne();
      due += this.intervalMs;
    }
    this.nextDueAtMs = this.committedCount >= this.graphemes.length ? null : due;
  }

  private commitOne(): void {
    if (this.committedCount >= this.graphemes.length) return;
    this.committedCount += 1;
    this.onCommit?.(this.snapshot());
  }

  private snapshot(): TypewriterSnapshot {
    return {
      committedCount: this.committedCount,
      totalGraphemeCount: this.graphemes.length,
      text: visibleText(this.graphemes, this.committedCount),
      complete: this.committedCount >= this.graphemes.length,
    };
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.scheduler.clear(this.timer);
      this.timer = null;
    }
  }
}
