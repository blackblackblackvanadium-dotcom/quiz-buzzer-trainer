export type QuestionId = string;
export type RevisionId = string;
export type SessionId = string;
export type AttemptId = string;

export const quizModes = ['normal', 'kimari', 'review', 'survival', 'study'] as const;
export type QuizMode = (typeof quizModes)[number];

export const quizPhases = ['loading', 'ready', 'reading', 'answering', 'result', 'finished'] as const;
export type QuizPhase = (typeof quizPhases)[number];

export interface QuestionRevision {
  readonly questionId: QuestionId;
  readonly revisionId: RevisionId;
  readonly prompt: string;
  readonly canonicalAnswer: string;
  readonly acceptableAnswers: readonly string[];
  readonly rejectedAnswers: readonly string[];
  readonly category: string;
  readonly pattern: string;
  readonly difficulty: number;
  readonly tags: readonly string[];
  readonly idealBuzzIndex?: number;
  readonly advancedBuzzIndex?: number;
  readonly createdAt: string;
}

export interface BuzzSnapshot {
  readonly buzzIndex: number;
  readonly totalGraphemeCount: number;
  readonly buzzRatio: number;
  readonly visibleText: string;
  readonly buzzTimeMs: number;
  readonly buzzAtMs: number;
}

export type JudgeKind = 'canonical' | 'acceptable' | 'rejected' | 'incorrect';

export interface JudgeResult {
  readonly kind: JudgeKind;
  readonly isCorrect: boolean;
  readonly normalizedSubmitted: string;
  readonly matchedAnswer: string | null;
}

export type AttemptOutcome = 'correct' | 'incorrect' | 'pass' | 'skip';

export interface Attempt {
  readonly attemptId: AttemptId;
  readonly questionId: QuestionId;
  readonly revisionId: RevisionId;
  readonly sessionId: SessionId;
  readonly mode: QuizMode;
  readonly outcome: AttemptOutcome;
  readonly judgeKind: JudgeKind | null;
  readonly submittedAnswer: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly buzzIndex: number | null;
  readonly buzzRatio: number | null;
  readonly buzzTimeMs: number | null;
  readonly responseTimeMs: number | null;
  readonly visibleTextAtBuzz: string | null;
}

export interface QuizSession {
  readonly sessionId: SessionId;
  readonly mode: QuizMode;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface StudyState {
  readonly questionId: QuestionId;
  readonly revisionId: RevisionId;
  readonly dueAt: string;
  readonly intervalDays: number;
  readonly easeFactor: number;
  readonly repetitions: number;
  readonly lapses: number;
  readonly bestBuzzIndex: number | null;
  readonly bestBuzzRatio: number | null;
  readonly bestResponseTimeMs: number | null;
  readonly correctCount: number;
  readonly attemptCount: number;
  readonly streak: number;
}

export interface AppSetting {
  readonly key: string;
  readonly value: unknown;
}

export const questionKey = (question: Pick<QuestionRevision, 'questionId' | 'revisionId'>): string =>
  `${question.questionId}::${question.revisionId}`;
