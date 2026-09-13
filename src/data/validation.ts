import {
  QUESTION_DATASET_FORMAT,
  QUESTION_DATASET_SCHEMA_VERSION,
  QUESTION_SCHEMA_VERSION,
  quizModes,
  type AnswerEntry,
  type AnswerRelation,
  type AppSetting,
  type Attempt,
  type DeterminingPoint,
  type DeterminingPointMethod,
  type DifficultyInfo,
  type GenreInfo,
  type Provenance,
  type QualityInfo,
  type QualityIssue,
  type QuestionDatasetV1,
  type QuestionMetadata,
  type QuestionRecordV1,
  type QuestionRevision,
  type QuestionTypeInfo,
  type QuizSession,
  type RejectedAnswerEntry,
  type RejectionReason,
  type SourceReference,
  type SourceRole,
  type StudyState,
  type TagRef,
} from '../domain/types';

const ANSWER_RELATIONS = new Set<AnswerRelation>([
  'alias', 'alternative_spelling', 'alternative_reading', 'abbreviation', 'full_name',
  'former_name', 'translated_name', 'partial_name', 'other',
]);
const REJECTION_REASONS = new Set<RejectionReason>([
  'incorrect', 'insufficient', 'ambiguous', 'different_entity', 'common_mistake',
  'historically_incorrect', 'other',
]);
const DETERMINING_POINT_METHODS = new Set<DeterminingPointMethod>([
  'human_semantic', 'rule_estimated', 'ai_estimated', 'dataset_uniqueness',
]);
const SOURCE_ROLES = new Set<SourceRole>([
  'fact_verification', 'answer_verification', 'question_origin', 'wording_reference', 'other',
]);
const QUALITY_STATUSES = new Set(['unchecked', 'valid', 'warning', 'error'] as const);
const QUALITY_SEVERITIES = new Set(['info', 'warning', 'error'] as const);
const QUESTION_STATUSES = new Set(['draft', 'active', 'suspended', 'deprecated'] as const);
const ORDINARY_SEPARATOR_OR_PUNCTUATION = /[\s\p{Z}\p{P}]+/gu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredRecord(record: Record<string, unknown>, key: string, label: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`${label}.${key} must be an object`);
  return value;
}

function requiredArray(record: Record<string, unknown>, key: string, label: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${label}.${key} must be an array`);
  return value;
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}.${key} must be a non-empty string`);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}.${key} must be a non-empty string when present`);
  return value;
}

function finiteNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}.${key} must be a finite number`);
  return value;
}

function optionalConfidence(record: Record<string, unknown>, key: string, label: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label}.${key} must be between 0 and 1 when present`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim().length > 0)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value;
}

function assertIsoDate(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid date string`);
}

function countGraphemes(text: string): number {
  return Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)).length;
}

function normalizeAnswerForCollision(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('ja-JP').trim().replace(ORDINARY_SEPARATOR_OR_PUNCTUATION, '');
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} contains duplicate value: ${value}`);
    seen.add(value);
  }
}

function parseProvenance(value: unknown, label: string): Provenance {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const method = requiredString(value, 'method', label);
  const confidence = optionalConfidence(value, 'confidence', label);
  const verifiedBy = optionalString(value, 'verifiedBy', label);
  const verifiedAt = optionalString(value, 'verifiedAt', label);
  if (verifiedAt !== undefined) assertIsoDate(verifiedAt, `${label}.verifiedAt`);
  const generator = optionalString(value, 'generator', label);
  const generatorVersion = optionalString(value, 'generatorVersion', label);
  const note = optionalString(value, 'note', label);
  const sourceIds = value.sourceIds === undefined ? undefined : stringArray(value.sourceIds, `${label}.sourceIds`);
  if (sourceIds !== undefined) assertUnique(sourceIds, `${label}.sourceIds`);
  return { method, confidence, verifiedBy, verifiedAt, generator, generatorVersion, sourceIds, note };
}

function parseAnswerEntry(value: unknown, label: string): AnswerEntry {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const id = requiredString(value, 'id', label);
  const text = requiredString(value, 'text', label);
  const reading = optionalString(value, 'reading', label);
  const note = optionalString(value, 'note', label);
  let relation: AnswerRelation | undefined;
  if (value.relation !== undefined) {
    if (!ANSWER_RELATIONS.has(value.relation as AnswerRelation)) throw new Error(`${label}.relation is invalid`);
    relation = value.relation as AnswerRelation;
  }
  const provenance = parseProvenance(value.provenance, `${label}.provenance`);
  return { id, text, reading, relation, note, provenance };
}

function parseRejectedAnswerEntry(value: unknown, label: string): RejectedAnswerEntry {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const base = parseAnswerEntry(value, label);
  if (!REJECTION_REASONS.has(value.rejectionReason as RejectionReason)) throw new Error(`${label}.rejectionReason is invalid`);
  return { ...base, rejectionReason: value.rejectionReason as RejectionReason };
}

function parseGenre(value: unknown, label: string): GenreInfo {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const primary = requiredString(value, 'primary', label);
  const taxonomyVersion = requiredString(value, 'taxonomyVersion', label);
  const secondary = value.secondary === undefined ? undefined : stringArray(value.secondary, `${label}.secondary`);
  if (secondary !== undefined) assertUnique(secondary, `${label}.secondary`);
  return { primary, secondary, taxonomyVersion, provenance: parseProvenance(value.provenance, `${label}.provenance`) };
}

function parseQuestionType(value: unknown, label: string): QuestionTypeInfo {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return {
    code: requiredString(value, 'code', label),
    taxonomyVersion: requiredString(value, 'taxonomyVersion', label),
    provenance: parseProvenance(value.provenance, `${label}.provenance`),
  };
}

function parseDifficulty(value: unknown, label: string): DifficultyInfo {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return {
    value: finiteNumber(value, 'value', label),
    scale: requiredString(value, 'scale', label),
    provenance: parseProvenance(value.provenance, `${label}.provenance`),
  };
}

function parseTag(value: unknown, label: string): TagRef {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return { id: requiredString(value, 'id', label) };
}

function parseDeterminingPoint(value: unknown, label: string): DeterminingPoint {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!DETERMINING_POINT_METHODS.has(value.method as DeterminingPointMethod)) throw new Error(`${label}.method is invalid`);
  const requiredPrefixGraphemes = value.requiredPrefixGraphemes;
  if (!Number.isInteger(requiredPrefixGraphemes) || (requiredPrefixGraphemes as number) < 1) {
    throw new Error(`${label}.requiredPrefixGraphemes must be a positive integer`);
  }
  const datasetScopeId = optionalString(value, 'datasetScopeId', label);
  if (value.method === 'dataset_uniqueness' && datasetScopeId === undefined) {
    throw new Error(`${label}.datasetScopeId is required for dataset_uniqueness`);
  }
  return {
    id: requiredString(value, 'id', label),
    method: value.method as DeterminingPointMethod,
    requiredPrefixGraphemes: requiredPrefixGraphemes as number,
    confidence: optionalConfidence(value, 'confidence', label),
    datasetScopeId,
    provenance: parseProvenance(value.provenance, `${label}.provenance`),
    note: optionalString(value, 'note', label),
  };
}

function parseSource(value: unknown, label: string): SourceReference {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!SOURCE_ROLES.has(value.role as SourceRole)) throw new Error(`${label}.role is invalid`);
  const accessedAt = optionalString(value, 'accessedAt', label);
  if (accessedAt !== undefined) assertIsoDate(accessedAt, `${label}.accessedAt`);
  return {
    id: requiredString(value, 'id', label),
    role: value.role as SourceRole,
    title: optionalString(value, 'title', label),
    url: optionalString(value, 'url', label),
    publisher: optionalString(value, 'publisher', label),
    accessedAt,
    note: optionalString(value, 'note', label),
  };
}

function parseQualityIssue(value: unknown, label: string): QualityIssue {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!QUALITY_SEVERITIES.has(value.severity as 'info' | 'warning' | 'error')) throw new Error(`${label}.severity is invalid`);
  return {
    code: requiredString(value, 'code', label),
    severity: value.severity as 'info' | 'warning' | 'error',
    message: requiredString(value, 'message', label),
    field: optionalString(value, 'field', label),
  };
}

function parseQuality(value: unknown, label: string): QualityInfo {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!QUALITY_STATUSES.has(value.status as 'unchecked' | 'valid' | 'warning' | 'error')) throw new Error(`${label}.status is invalid`);
  const issues = requiredArray(value, 'issues', label).map((item, index) => parseQualityIssue(item, `${label}.issues[${index}]`));
  if (value.status === 'valid' && issues.some((issue) => issue.severity === 'error')) {
    throw new Error(`${label}.status=valid cannot contain error issues`);
  }
  const lastCheckedAt = optionalString(value, 'lastCheckedAt', label);
  if (lastCheckedAt !== undefined) assertIsoDate(lastCheckedAt, `${label}.lastCheckedAt`);
  return {
    status: value.status as 'unchecked' | 'valid' | 'warning' | 'error',
    issues,
    lastCheckedAt,
    qualityProfileVersion: optionalString(value, 'qualityProfileVersion', label),
  };
}

function parseMetadata(value: unknown, label: string): QuestionMetadata {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const createdAt = requiredString(value, 'createdAt', label);
  const updatedAt = requiredString(value, 'updatedAt', label);
  assertIsoDate(createdAt, `${label}.createdAt`);
  assertIsoDate(updatedAt, `${label}.updatedAt`);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error(`${label}.updatedAt must not precede createdAt`);
  if (!QUESTION_STATUSES.has(value.status as 'draft' | 'active' | 'suspended' | 'deprecated')) throw new Error(`${label}.status is invalid`);
  const importedAt = optionalString(value, 'importedAt', label);
  if (importedAt !== undefined) assertIsoDate(importedAt, `${label}.importedAt`);
  return {
    createdAt,
    updatedAt,
    createdBy: optionalString(value, 'createdBy', label),
    updatedBy: optionalString(value, 'updatedBy', label),
    importedAt,
    importBatchId: optionalString(value, 'importBatchId', label),
    status: value.status as 'draft' | 'active' | 'suspended' | 'deprecated',
  };
}

function assertProvenanceSources(provenance: Provenance, sourceIds: ReadonlySet<string>, label: string): void {
  for (const sourceId of provenance.sourceIds ?? []) {
    if (!sourceIds.has(sourceId)) throw new Error(`${label}.sourceIds references unknown source: ${sourceId}`);
  }
}

export function parseQuestionRecordV1(value: unknown): QuestionRecordV1 {
  if (!isRecord(value)) throw new Error('Question must be an object');
  if (value.schemaVersion !== QUESTION_SCHEMA_VERSION) throw new Error('Unsupported Question schemaVersion');

  const questionId = requiredString(value, 'questionId', 'Question');
  const revisionId = requiredString(value, 'revisionId', 'Question');
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) throw new Error('Question.revision must be a positive integer');
  const revision = value.revision as number;
  const prompt = requiredString(value, 'prompt', 'Question');
  const graphemeCount = countGraphemes(prompt);
  if (graphemeCount === 0) throw new Error('Question.prompt must contain at least one grapheme');

  const answersRecord = requiredRecord(value, 'answers', 'Question');
  const primaryAnswer = parseAnswerEntry(answersRecord.primaryAnswer, 'Question.answers.primaryAnswer');
  const acceptedAnswers = requiredArray(answersRecord, 'acceptedAnswers', 'Question.answers')
    .map((item, index) => parseAnswerEntry(item, `Question.answers.acceptedAnswers[${index}]`));
  const rejectedAnswers = requiredArray(answersRecord, 'rejectedAnswers', 'Question.answers')
    .map((item, index) => parseRejectedAnswerEntry(item, `Question.answers.rejectedAnswers[${index}]`));
  assertUnique([primaryAnswer.id, ...acceptedAnswers.map((item) => item.id), ...rejectedAnswers.map((item) => item.id)], 'Question answer ids');

  const primaryNormalized = normalizeAnswerForCollision(primaryAnswer.text);
  const acceptedNormalized = acceptedAnswers.map((item) => normalizeAnswerForCollision(item.text));
  const rejectedNormalized = rejectedAnswers.map((item) => normalizeAnswerForCollision(item.text));
  if (primaryNormalized.length === 0) throw new Error('Question primary answer normalizes to empty text');
  assertUnique(acceptedNormalized, 'Question accepted answers');
  assertUnique(rejectedNormalized, 'Question rejected answers');
  if (acceptedNormalized.includes(primaryNormalized)) throw new Error('Question accepted answer duplicates primary answer');
  if (rejectedNormalized.includes(primaryNormalized) || rejectedNormalized.some((item) => acceptedNormalized.includes(item))) {
    throw new Error('Question accepted/primary answers must not collide with rejected answers');
  }

  const classificationRecord = requiredRecord(value, 'classification', 'Question');
  const genre = parseGenre(classificationRecord.genre, 'Question.classification.genre');
  const questionType = classificationRecord.questionType === undefined
    ? undefined
    : parseQuestionType(classificationRecord.questionType, 'Question.classification.questionType');
  const tags = requiredArray(classificationRecord, 'tags', 'Question.classification')
    .map((item, index) => parseTag(item, `Question.classification.tags[${index}]`));
  assertUnique(tags.map((tag) => tag.id), 'Question.classification.tags');
  const difficulty = classificationRecord.difficulty === undefined
    ? undefined
    : parseDifficulty(classificationRecord.difficulty, 'Question.classification.difficulty');

  const determiningPoints = requiredArray(value, 'determiningPoints', 'Question')
    .map((item, index) => parseDeterminingPoint(item, `Question.determiningPoints[${index}]`));
  assertUnique(determiningPoints.map((point) => point.id), 'Question.determiningPoints ids');
  for (const point of determiningPoints) {
    if (point.requiredPrefixGraphemes > graphemeCount) {
      throw new Error(`Question determining point ${point.id} exceeds prompt graphemeCount`);
    }
  }

  const sources = requiredArray(value, 'sources', 'Question')
    .map((item, index) => parseSource(item, `Question.sources[${index}]`));
  assertUnique(sources.map((source) => source.id), 'Question.sources ids');
  const knownSourceIds = new Set(sources.map((source) => source.id));
  assertProvenanceSources(primaryAnswer.provenance, knownSourceIds, 'Question.answers.primaryAnswer.provenance');
  acceptedAnswers.forEach((entry, index) => assertProvenanceSources(entry.provenance, knownSourceIds, `Question.answers.acceptedAnswers[${index}].provenance`));
  rejectedAnswers.forEach((entry, index) => assertProvenanceSources(entry.provenance, knownSourceIds, `Question.answers.rejectedAnswers[${index}].provenance`));
  assertProvenanceSources(genre.provenance, knownSourceIds, 'Question.classification.genre.provenance');
  if (questionType !== undefined) assertProvenanceSources(questionType.provenance, knownSourceIds, 'Question.classification.questionType.provenance');
  if (difficulty !== undefined) assertProvenanceSources(difficulty.provenance, knownSourceIds, 'Question.classification.difficulty.provenance');
  determiningPoints.forEach((point, index) => assertProvenanceSources(point.provenance, knownSourceIds, `Question.determiningPoints[${index}].provenance`));

  const derivedRecord = requiredRecord(value, 'derived', 'Question');
  if (!Number.isInteger(derivedRecord.graphemeCount) || derivedRecord.graphemeCount !== graphemeCount) {
    throw new Error('Question.derived.graphemeCount must equal prompt grapheme count');
  }
  const derived = {
    graphemeCount,
    graphemeProfile: requiredString(derivedRecord, 'graphemeProfile', 'Question.derived'),
    exactTextHash: requiredString(derivedRecord, 'exactTextHash', 'Question.derived'),
    duplicateDetectionKey: requiredString(derivedRecord, 'duplicateDetectionKey', 'Question.derived'),
    computedAt: requiredString(derivedRecord, 'computedAt', 'Question.derived'),
    generatorVersion: requiredString(derivedRecord, 'generatorVersion', 'Question.derived'),
  };
  assertIsoDate(derived.computedAt, 'Question.derived.computedAt');

  const quality = parseQuality(value.quality, 'Question.quality');
  const metadata = parseMetadata(value.metadata, 'Question.metadata');
  if (value.extensions !== undefined && !isRecord(value.extensions)) throw new Error('Question.extensions must be an object when present');

  return {
    schemaVersion: QUESTION_SCHEMA_VERSION,
    questionId,
    revisionId,
    revision,
    prompt,
    answers: { primaryAnswer, acceptedAnswers, rejectedAnswers },
    classification: { genre, questionType, tags, difficulty },
    determiningPoints,
    sources,
    derived,
    quality,
    metadata,
    extensions: value.extensions as Readonly<Record<string, unknown>> | undefined,
  };
}

/** Existing application call sites retain this name; it validates canonical Schema v1 only. */
export const parseQuestionRevision = parseQuestionRecordV1;

export function parseQuestionDatasetV1(value: unknown): QuestionDatasetV1 {
  if (!isRecord(value) || value.format !== QUESTION_DATASET_FORMAT || value.schemaVersion !== QUESTION_DATASET_SCHEMA_VERSION) {
    throw new Error('Unsupported Question dataset format/schemaVersion');
  }
  const datasetId = requiredString(value, 'datasetId', 'QuestionDataset');
  const datasetVersion = requiredString(value, 'datasetVersion', 'QuestionDataset');
  const exportedAt = requiredString(value, 'exportedAt', 'QuestionDataset');
  assertIsoDate(exportedAt, 'QuestionDataset.exportedAt');
  const generatorRecord = requiredRecord(value, 'generator', 'QuestionDataset');
  const generator = {
    name: requiredString(generatorRecord, 'name', 'QuestionDataset.generator'),
    version: requiredString(generatorRecord, 'version', 'QuestionDataset.generator'),
  };
  const questions = requiredArray(value, 'questions', 'QuestionDataset').map(parseQuestionRecordV1);
  const keys = questions.map((question) => `${question.questionId}::${question.revisionId}`);
  assertUnique(keys, 'QuestionDataset question revisions');
  const checksum = optionalString(value, 'checksum', 'QuestionDataset');
  if (checksum !== undefined && !/^[0-9a-f]{64}$/iu.test(checksum)) throw new Error('QuestionDataset.checksum must be a SHA-256 hex digest');
  return {
    schemaVersion: QUESTION_DATASET_SCHEMA_VERSION,
    format: QUESTION_DATASET_FORMAT,
    datasetId,
    datasetVersion,
    exportedAt,
    generator,
    questions,
    checksum,
  };
}

function nullableNumber(record: Record<string, unknown>, key: string, label: string): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}.${key} must be a finite number or null`);
  return value;
}

function parseAttempt(value: unknown): Attempt {
  if (!isRecord(value)) throw new Error('Attempt must be an object');
  for (const key of ['attemptId', 'questionId', 'revisionId', 'sessionId', 'startedAt', 'completedAt'] as const) requiredString(value, key, 'Attempt');
  if (!quizModes.includes(value.mode as (typeof quizModes)[number])) throw new Error('Attempt.mode is invalid');
  if (!['correct', 'incorrect', 'pass', 'skip'].includes(String(value.outcome))) throw new Error('Attempt.outcome is invalid');
  if (!(value.judgeKind === null || ['canonical', 'acceptable', 'rejected', 'incorrect'].includes(String(value.judgeKind)))) throw new Error('Attempt.judgeKind is invalid');
  if (!(value.submittedAnswer === null || typeof value.submittedAnswer === 'string')) throw new Error('Attempt.submittedAnswer is invalid');
  for (const key of ['buzzIndex', 'buzzRatio', 'buzzTimeMs', 'responseTimeMs'] as const) nullableNumber(value, key, 'Attempt');
  if (!(value.visibleTextAtBuzz === null || typeof value.visibleTextAtBuzz === 'string')) throw new Error('Attempt.visibleTextAtBuzz is invalid');
  return value as unknown as Attempt;
}

function parseStudyState(value: unknown): StudyState {
  if (!isRecord(value)) throw new Error('StudyState must be an object');
  for (const key of ['questionId', 'revisionId', 'dueAt'] as const) requiredString(value, key, 'StudyState');
  for (const key of ['intervalDays', 'easeFactor', 'repetitions', 'lapses', 'correctCount', 'attemptCount', 'streak'] as const) finiteNumber(value, key, 'StudyState');
  for (const key of ['bestBuzzIndex', 'bestBuzzRatio', 'bestResponseTimeMs'] as const) nullableNumber(value, key, 'StudyState');
  return value as unknown as StudyState;
}

function parseSession(value: unknown): QuizSession {
  if (!isRecord(value)) throw new Error('Session must be an object');
  requiredString(value, 'sessionId', 'Session');
  requiredString(value, 'startedAt', 'Session');
  if (!quizModes.includes(value.mode as (typeof quizModes)[number])) throw new Error('Session.mode is invalid');
  if (!(value.endedAt === null || typeof value.endedAt === 'string')) throw new Error('Session.endedAt is invalid');
  return value as unknown as QuizSession;
}

function parseSetting(value: unknown): AppSetting {
  if (!isRecord(value)) throw new Error('Setting must be an object');
  requiredString(value, 'key', 'Setting');
  return { key: value.key as string, value: value.value };
}

export interface PortableBackupV1 {
  readonly format: 'qbt-backup';
  readonly version: 1;
  readonly exportedAt: string;
  readonly appVersion: string;
  readonly dbSchemaVersion: number;
  readonly questionDataVersion: string;
  readonly data: {
    readonly questions: readonly QuestionRevision[];
    readonly attempts: readonly Attempt[];
    readonly studyStates: readonly StudyState[];
    readonly sessions: readonly QuizSession[];
    readonly settings: readonly AppSetting[];
  };
}

export function parsePortableBackup(value: unknown): PortableBackupV1 {
  if (!isRecord(value) || value.format !== 'qbt-backup' || value.version !== 1) throw new Error('Unsupported backup format/version');
  requiredString(value, 'exportedAt', 'Backup');
  requiredString(value, 'appVersion', 'Backup');
  requiredString(value, 'questionDataVersion', 'Backup');
  if (!Number.isInteger(value.dbSchemaVersion) || (value.dbSchemaVersion as number) < 1) throw new Error('Backup.dbSchemaVersion is invalid');
  if (!isRecord(value.data)) throw new Error('Backup.data must be an object');
  for (const key of ['questions', 'attempts', 'studyStates', 'sessions', 'settings'] as const) {
    if (!Array.isArray(value.data[key])) throw new Error(`Backup.data.${key} must be an array`);
  }

  return {
    format: 'qbt-backup',
    version: 1,
    exportedAt: value.exportedAt as string,
    appVersion: value.appVersion as string,
    dbSchemaVersion: value.dbSchemaVersion as number,
    questionDataVersion: value.questionDataVersion as string,
    data: {
      questions: (value.data.questions as unknown[]).map(parseQuestionRecordV1),
      attempts: (value.data.attempts as unknown[]).map(parseAttempt),
      studyStates: (value.data.studyStates as unknown[]).map(parseStudyState),
      sessions: (value.data.sessions as unknown[]).map(parseSession),
      settings: (value.data.settings as unknown[]).map(parseSetting),
    },
  };
}
