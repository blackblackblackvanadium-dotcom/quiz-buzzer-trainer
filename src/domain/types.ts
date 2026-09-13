export type QuestionId = string;
export type RevisionId = string;
export type SessionId = string;
export type AttemptId = string;

export const QUESTION_SCHEMA_VERSION = 1 as const;
export const QUESTION_DATASET_FORMAT = 'qbt-question-dataset' as const;
export const QUESTION_DATASET_SCHEMA_VERSION = 1 as const;

export type AnswerRelation =
  | 'alias'
  | 'alternative_spelling'
  | 'alternative_reading'
  | 'abbreviation'
  | 'full_name'
  | 'former_name'
  | 'translated_name'
  | 'partial_name'
  | 'other';

export type RejectionReason =
  | 'incorrect'
  | 'insufficient'
  | 'ambiguous'
  | 'different_entity'
  | 'common_mistake'
  | 'historically_incorrect'
  | 'other';

export interface Provenance {
  readonly method: string;
  readonly confidence?: number;
  readonly verifiedBy?: string;
  readonly verifiedAt?: string;
  readonly generator?: string;
  readonly generatorVersion?: string;
  readonly sourceIds?: readonly string[];
  readonly note?: string;
}

export interface AnswerEntry {
  readonly id: string;
  readonly text: string;
  readonly reading?: string;
  readonly relation?: AnswerRelation;
  readonly note?: string;
  readonly provenance: Provenance;
}

export interface RejectedAnswerEntry extends AnswerEntry {
  readonly rejectionReason: RejectionReason;
}

export interface GenreInfo {
  readonly primary: string;
  readonly secondary?: readonly string[];
  readonly taxonomyVersion: string;
  readonly provenance: Provenance;
}

export interface QuestionTypeInfo {
  readonly code: string;
  readonly taxonomyVersion: string;
  readonly provenance: Provenance;
}

export interface DifficultyInfo {
  readonly value: number;
  readonly scale: string;
  readonly provenance: Provenance;
}

export interface TagRef {
  readonly id: string;
}

export type DeterminingPointMethod =
  | 'human_semantic'
  | 'rule_estimated'
  | 'ai_estimated'
  | 'dataset_uniqueness';

export interface DeterminingPoint {
  readonly id: string;
  readonly method: DeterminingPointMethod;
  readonly requiredPrefixGraphemes: number;
  readonly confidence?: number;
  readonly datasetScopeId?: string;
  readonly provenance: Provenance;
  readonly note?: string;
}

export type SourceRole =
  | 'fact_verification'
  | 'answer_verification'
  | 'question_origin'
  | 'wording_reference'
  | 'other';

export interface SourceReference {
  readonly id: string;
  readonly role: SourceRole;
  readonly title?: string;
  readonly url?: string;
  readonly publisher?: string;
  readonly accessedAt?: string;
  readonly note?: string;
}

export interface DerivedQuestionData {
  readonly graphemeCount: number;
  readonly graphemeProfile: string;
  readonly exactTextHash: string;
  readonly duplicateDetectionKey: string;
  readonly computedAt: string;
  readonly generatorVersion: string;
}

export type QualityStatus = 'unchecked' | 'valid' | 'warning' | 'error';
export type QualityIssueSeverity = 'info' | 'warning' | 'error';

export interface QualityIssue {
  readonly code: string;
  readonly severity: QualityIssueSeverity;
  readonly message: string;
  readonly field?: string;
}

export interface QualityInfo {
  readonly status: QualityStatus;
  readonly issues: readonly QualityIssue[];
  readonly lastCheckedAt?: string;
  readonly qualityProfileVersion?: string;
}

export type QuestionStatus = 'draft' | 'active' | 'suspended' | 'deprecated';

export interface QuestionMetadata {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy?: string;
  readonly updatedBy?: string;
  readonly importedAt?: string;
  readonly importBatchId?: string;
  readonly status: QuestionStatus;
}

export interface QuestionRecordV1 {
  readonly schemaVersion: typeof QUESTION_SCHEMA_VERSION;
  readonly questionId: QuestionId;
  readonly revisionId: RevisionId;
  readonly revision: number;
  readonly prompt: string;
  readonly answers: {
    readonly primaryAnswer: AnswerEntry;
    readonly acceptedAnswers: readonly AnswerEntry[];
    readonly rejectedAnswers: readonly RejectedAnswerEntry[];
  };
  readonly classification: {
    readonly genre: GenreInfo;
    readonly questionType?: QuestionTypeInfo;
    readonly tags: readonly TagRef[];
    readonly difficulty?: DifficultyInfo;
  };
  readonly determiningPoints: readonly DeterminingPoint[];
  readonly sources: readonly SourceReference[];
  readonly derived: DerivedQuestionData;
  readonly quality: QualityInfo;
  readonly metadata: QuestionMetadata;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/** Compatibility name used by the application layer; the canonical shape is QuestionRecordV1. */
export type QuestionRevision = QuestionRecordV1;

export interface QuestionDatasetV1 {
  readonly schemaVersion: typeof QUESTION_DATASET_SCHEMA_VERSION;
  readonly format: typeof QUESTION_DATASET_FORMAT;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly exportedAt: string;
  readonly generator: {
    readonly name: string;
    readonly version: string;
  };
  readonly questions: readonly QuestionRecordV1[];
  readonly checksum?: string;
}

export const quizModes = ['normal', 'kimari', 'review', 'survival', 'study'] as const;
export type QuizMode = (typeof quizModes)[number];

export const quizPhases = ['loading', 'ready', 'reading', 'answering', 'result', 'finished'] as const;
export type QuizPhase = (typeof quizPhases)[number];

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

export const questionKey = (question: Pick<QuestionRecordV1, 'questionId' | 'revisionId'>): string =>
  `${question.questionId}::${question.revisionId}`;
