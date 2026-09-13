export type QuestionId = string;
export type RevisionId = string;
export type SessionId = string;
export type AttemptId = string;

export const QUESTION_SCHEMA_VERSION = 1 as const;
export const QUESTION_DATASET_FORMAT = 'qbt-question-dataset' as const;
export const QUESTION_DATASET_SCHEMA_VERSION = 1 as const;
export const QUALITY_PROFILE_VERSION = 'qbt-quality-v1' as const;
export const DERIVED_GENERATOR_VERSION = 'qbt-derived-v1' as const;

export type ProvenanceMethod =
  | 'human_verified'
  | 'human_unverified'
  | 'imported'
  | 'computed'
  | 'rule_inferred'
  | 'ai_inferred'
  | 'unknown';

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
  readonly method: ProvenanceMethod;
  readonly confidence?: number | undefined;
  readonly verifiedBy?: string | undefined;
  readonly verifiedAt?: string | undefined;
  readonly generator?: string | undefined;
  readonly generatorVersion?: string | undefined;
  readonly sourceIds?: readonly string[] | undefined;
  readonly note?: string | undefined;
}

export interface AnswerEntry {
  readonly id: string;
  readonly text: string;
  readonly reading?: string | undefined;
  readonly relation?: AnswerRelation | undefined;
  readonly note?: string | undefined;
  readonly provenance: Provenance;
}

export interface RejectedAnswerEntry extends AnswerEntry {
  readonly rejectionReason: RejectionReason;
}

export interface GenreInfo {
  readonly primary: string;
  readonly secondary?: readonly string[] | undefined;
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
  readonly confidence?: number | undefined;
  readonly datasetScopeId?: string | undefined;
  readonly provenance: Provenance;
  readonly note?: string | undefined;
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
  readonly title?: string | undefined;
  readonly url?: string | undefined;
  readonly publisher?: string | undefined;
  readonly accessedAt?: string | undefined;
  readonly note?: string | undefined;
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
  readonly field?: string | undefined;
}

export interface QualityInfo {
  readonly status: QualityStatus;
  readonly issues: readonly QualityIssue[];
  readonly lastCheckedAt?: string | undefined;
  readonly qualityProfileVersion: string;
}

export type QuestionStatus = 'draft' | 'active' | 'suspended' | 'deprecated';

export interface QuestionMetadata {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy?: string | undefined;
  readonly updatedBy?: string | undefined;
  readonly importedAt?: string | undefined;
  readonly importBatchId?: string | undefined;
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
    readonly questionType?: QuestionTypeInfo | undefined;
    readonly tags: readonly TagRef[];
    readonly difficulty?: DifficultyInfo | undefined;
  };
  readonly determiningPoints: readonly DeterminingPoint[];
  readonly sources: readonly SourceReference[];
  readonly derived: DerivedQuestionData;
  readonly quality: QualityInfo;
  readonly metadata: QuestionMetadata;
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
}

/** Compatibility name used by the application layer; canonical storage is QuestionRecordV1. */
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
  readonly checksum?: string | undefined;
}

export type QuestionImportMode = 'insert_only' | 'merge' | 'restore';

export interface QuestionImportIssue {
  readonly questionId: QuestionId;
  readonly revisionId: RevisionId;
  readonly issue: QualityIssue;
}

export interface QuestionImportResult {
  readonly mode: QuestionImportMode;
  readonly inserted: number;
  readonly skipped: number;
  readonly replaced: number;
  readonly issues: readonly QuestionImportIssue[];
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

export interface KimariReference {
  readonly questionId: QuestionId;
  readonly revisionId: RevisionId;
  readonly referenceBuzzIndex: number;
}

export interface KimariMetrics {
  readonly referenceBuzzIndex: number;
  readonly playerBuzzIndex: number | null;
  readonly deltaGraphemes: number | null;
}

export type AttemptOutcome = 'correct' | 'incorrect' | 'pass' | 'skip' | 'aborted';

/** QBT-03 persisted Attempt contract plus retained presentation/audit aliases used by Phase 1 UI/analytics. */
export interface PersistedAttempt {
  readonly attemptId: AttemptId;
  readonly questionId: QuestionId;
  readonly revisionId: RevisionId;
  readonly sessionId: SessionId;
  readonly mode: QuizMode;
  readonly outcome: AttemptOutcome;
  readonly isCorrect: boolean | null;
  readonly startedAtEpochMs: number;
  readonly completedAtEpochMs: number;
  readonly buzzIndex: number | null;
  readonly totalGraphemeCount: number | null;
  readonly buzzRatio: number | null;
  readonly buzzTimeMs: number | null;
  readonly responseTimeMs: number | null;
  readonly kimari: KimariMetrics | null;

  readonly judgeKind: JudgeKind | null;
  readonly submittedAnswer: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly visibleTextAtBuzz: string | null;
}

export type Attempt = PersistedAttempt;

export type SessionEndReason =
  | 'completed'
  | 'survival_failed'
  | 'survival_cleared'
  | 'user_ended'
  | 'fatal_error';

export interface SurvivalFailure {
  readonly failedAttemptId: AttemptId;
  readonly cause: 'incorrect' | 'pass';
}

export interface KimariSessionResult {
  readonly mode: 'kimari';
}

export interface SurvivalSessionResult {
  readonly mode: 'survival';
  readonly score: number;
  readonly cleared: boolean;
  readonly failure: SurvivalFailure | null;
}

export type SessionModeResult = KimariSessionResult | SurvivalSessionResult | null;

/** QBT-03 persisted Session contract plus retained ISO aliases used by Phase 1 backup/UI. */
export interface PersistedSession {
  readonly sessionId: SessionId;
  readonly mode: QuizMode;
  readonly startedAtEpochMs: number;
  readonly endedAtEpochMs: number | null;
  readonly endReason: SessionEndReason | null;
  readonly targetQuestionCount: number;
  readonly consumedQuestionCount: number;
  readonly modeResult: SessionModeResult;

  readonly startedAt: string;
  readonly endedAt: string | null;
}

export type QuizSession = PersistedSession;

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
