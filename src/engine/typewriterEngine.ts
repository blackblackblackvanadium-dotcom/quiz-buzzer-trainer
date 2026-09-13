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
  private startedAtMs: number | null = null;
  private buzzAcceptedAtMs: number | null = null;
  private answerSubmittedAtMs: number | null = null;
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
    if (!this.paused || this.startedAtMs !== null) {
      throw new Error('TypewriterEngine can only be started once');
    }

    this.onCommit = onCommit;
    this.paused = false;
    this.startedAtMs = this.clock.now();

    if (this.graphemes.length === 0) {
      this.onCommit(this.snapshot());
      return;
    }

    // DEC-005: entering READING and presenting the first grapheme share the
    // same start point. Only subsequent graphemes wait for intervalMs.
    this.commitOne();
    this.scheduleNextCommit();
  }

  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  getSnapshot(): TypewriterSnapshot {
    return this.snapshot();
  }

  /**
   * BUZZ is based only on graphemes that were actually committed before the
   * BUZZ handler entered this method. Scheduled/due-but-not-executed timer
   * callbacks never advance the presentation and are never caught up here.
   * The accepted BUZZ time also becomes the sole response-time origin.
   */
  buzz(buzzAtMs = this.clock.now()): BuzzSnapshot {
    const startedAtMs = this.startedAtMs;
    if (startedAtMs === null) {
      throw new Error('Cannot BUZZ before reading starts');
    }
    if (this.buzzAcceptedAtMs !== null) {
      throw new Error('BUZZ has already been accepted');
    }

    // Freeze presentation first. JavaScript executes this synchronously, so a
    // stale timer callback that runs later observes paused=true and cannot
    // commit another grapheme.
    this.pause();
    this.buzzAcceptedAtMs = buzzAtMs;

    const totalGraphemeCount = this.graphemes.length;
    const buzzIndex = this.committedCount;
    return {
      buzzIndex,
      totalGraphemeCount,
      buzzRatio: totalGraphemeCount === 0 ? 0 : buzzIndex / totalGraphemeCount,
      visibleText: visibleText(this.graphemes, buzzIndex),
      buzzTimeMs: Math.max(0, buzzAtMs - startedAtMs),
      buzzAtMs,
    };
  }

  /**
   * Confirm answer submission using the same monotonic clock that accepted
   * BUZZ. UI code receives only the finalized duration; it never computes a
   * performance.now() delta itself.
   */
  confirmAnswerSubmit(): number {
    const buzzAcceptedAtMs = this.buzzAcceptedAtMs;
    if (buzzAcceptedAtMs === null) {
      throw new Error('Cannot submit an answer before BUZZ is accepted');
    }
    if (this.answerSubmittedAtMs !== null) {
      throw new Error('Answer submission has already been confirmed');
    }

    const submitAtMs = this.clock.now();
    if (submitAtMs < buzzAcceptedAtMs) {
      throw new Error('Monotonic clock moved backwards after BUZZ');
    }

    this.answerSubmittedAtMs = submitAtMs;
    return submitAtMs - buzzAcceptedAtMs;
  }

  /**
   * One executed timer callback produces at most one presentation commit.
   * The next interval starts from that actual callback execution, so delayed
   * timers slow the reveal instead of revealing multiple graphemes at once.
   */
  private scheduleNextCommit(): void {
    if (this.paused || this.committedCount >= this.graphemes.length) return;

    this.clearTimer();
    this.timer = this.scheduler.set(() => {
      this.timer = null;
      if (this.paused || this.committedCount >= this.graphemes.length) return;

      this.commitOne();
      this.scheduleNextCommit();
    }, this.intervalMs);
  }

  private commitOne(): void {
    if (this.paused || this.committedCount >= this.graphemes.length) return;
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
