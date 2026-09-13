import type {
  AttemptOutcome,
  KimariMetrics,
  PersistedAttempt,
  QuizSession,
  SessionEndReason,
  SessionModeResult,
} from '../domain/types';
import { parsePortableBackup, type PortableBackupV1 } from '../data/validation';

const OUTCOMES = new Set<AttemptOutcome>(['correct', 'incorrect', 'pass', 'skip', 'aborted']);
const END_REASONS = new Set<SessionEndReason>([
  'completed', 'survival_failed', 'survival_cleared', 'user_ended', 'fatal_error',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function nullableFiniteNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  return finiteNumber(value, label);
}

function epochFromIso(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp`);
  return parsed;
}

function expectedCorrectness(outcome: AttemptOutcome): boolean | null {
  if (outcome === 'correct') return true;
  if (outcome === 'incorrect') return false;
  return null;
}

function projectAttemptForLegacyValidation(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    attemptId: value.attemptId,
    questionId: value.questionId,
    revisionId: value.revisionId,
    sessionId: value.sessionId,
    mode: value.mode,
    outcome: value.outcome === 'aborted' ? 'pass' : value.outcome,
    judgeKind: value.judgeKind,
    submittedAnswer: value.submittedAnswer,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    buzzIndex: value.buzzIndex,
    buzzRatio: value.buzzRatio,
    buzzTimeMs: value.buzzTimeMs,
    responseTimeMs: value.responseTimeMs,
    visibleTextAtBuzz: value.visibleTextAtBuzz,
  };
}

function projectSessionForLegacyValidation(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    sessionId: value.sessionId,
    mode: value.mode,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
  };
}

function projectForLegacyValidation(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.data)) return value;
  return {
    ...value,
    data: {
      ...value.data,
      attempts: Array.isArray(value.data.attempts)
        ? value.data.attempts.map(projectAttemptForLegacyValidation)
        : value.data.attempts,
      sessions: Array.isArray(value.data.sessions)
        ? value.data.sessions.map(projectSessionForLegacyValidation)
        : value.data.sessions,
    },
  };
}

function parseKimari(value: unknown, label: string): KimariMetrics | null {
  if (value === null) return null;
  const record = requireRecord(value, label);
  const allowed = new Set(['referenceBuzzIndex', 'playerBuzzIndex', 'deltaGraphemes']);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`${label}.${key} is an unknown field`);
  const referenceBuzzIndex = finiteNumber(record.referenceBuzzIndex, `${label}.referenceBuzzIndex`);
  const playerBuzzIndex = nullableFiniteNumber(record.playerBuzzIndex, `${label}.playerBuzzIndex`);
  const deltaGraphemes = nullableFiniteNumber(record.deltaGraphemes, `${label}.deltaGraphemes`);
  if (!Number.isInteger(referenceBuzzIndex) || referenceBuzzIndex < 0) throw new Error(`${label}.referenceBuzzIndex is invalid`);
  if (playerBuzzIndex !== null && (!Number.isInteger(playerBuzzIndex) || playerBuzzIndex < 0)) throw new Error(`${label}.playerBuzzIndex is invalid`);
  const expectedDelta = playerBuzzIndex === null ? null : playerBuzzIndex - referenceBuzzIndex;
  if (deltaGraphemes !== expectedDelta) throw new Error(`${label}.deltaGraphemes invariant failed`);
  return { referenceBuzzIndex, playerBuzzIndex, deltaGraphemes };
}

function normalizeAttempt(rawValue: unknown, legacyValidated: PortableBackupV1['data']['attempts'][number], index: number): PersistedAttempt {
  const raw = requireRecord(rawValue, `Backup.data.attempts[${index}]`);
  if (!OUTCOMES.has(raw.outcome as AttemptOutcome)) throw new Error(`Backup.data.attempts[${index}].outcome is invalid`);
  const outcome = raw.outcome as AttemptOutcome;
  const startedAtEpochMs = raw.startedAtEpochMs === undefined
    ? epochFromIso(legacyValidated.startedAt, `Backup.data.attempts[${index}].startedAt`)
    : finiteNumber(raw.startedAtEpochMs, `Backup.data.attempts[${index}].startedAtEpochMs`);
  const completedAtEpochMs = raw.completedAtEpochMs === undefined
    ? epochFromIso(legacyValidated.completedAt, `Backup.data.attempts[${index}].completedAt`)
    : finiteNumber(raw.completedAtEpochMs, `Backup.data.attempts[${index}].completedAtEpochMs`);
  if (completedAtEpochMs < startedAtEpochMs) throw new Error(`Backup.data.attempts[${index}] completion precedes start`);

  const isCorrect = raw.isCorrect === undefined ? expectedCorrectness(outcome) : raw.isCorrect;
  if (!(isCorrect === true || isCorrect === false || isCorrect === null) || isCorrect !== expectedCorrectness(outcome)) {
    throw new Error(`Backup.data.attempts[${index}].isCorrect does not match outcome`);
  }

  const totalGraphemeCount = raw.totalGraphemeCount === undefined
    ? null
    : nullableFiniteNumber(raw.totalGraphemeCount, `Backup.data.attempts[${index}].totalGraphemeCount`);
  if (totalGraphemeCount !== null && (!Number.isInteger(totalGraphemeCount) || totalGraphemeCount < 0)) {
    throw new Error(`Backup.data.attempts[${index}].totalGraphemeCount is invalid`);
  }
  const kimari = raw.kimari === undefined ? null : parseKimari(raw.kimari, `Backup.data.attempts[${index}].kimari`);
  if (raw.mode === 'kimari' && raw.kimari !== undefined && outcome !== 'aborted' && kimari === null) {
    throw new Error(`Backup.data.attempts[${index}].kimari is required for current Kimari records`);
  }

  return {
    ...legacyValidated,
    outcome,
    isCorrect,
    startedAtEpochMs,
    completedAtEpochMs,
    totalGraphemeCount,
    kimari,
  };
}

function parseModeResult(value: unknown, label: string): SessionModeResult {
  if (value === null) return null;
  const record = requireRecord(value, label);
  if (record.mode === 'kimari') {
    if (Object.keys(record).some((key) => key !== 'mode')) throw new Error(`${label} has unknown Kimari fields`);
    return { mode: 'kimari' };
  }
  if (record.mode !== 'survival') throw new Error(`${label}.mode is invalid`);
  const score = finiteNumber(record.score, `${label}.score`);
  if (!Number.isInteger(score) || score < 0) throw new Error(`${label}.score is invalid`);
  if (typeof record.cleared !== 'boolean') throw new Error(`${label}.cleared must be boolean`);
  let failure = null;
  if (record.failure !== null) {
    const failureRecord = requireRecord(record.failure, `${label}.failure`);
    if (typeof failureRecord.failedAttemptId !== 'string' || failureRecord.failedAttemptId.length === 0) throw new Error(`${label}.failure.failedAttemptId is invalid`);
    if (failureRecord.cause !== 'incorrect' && failureRecord.cause !== 'pass') throw new Error(`${label}.failure.cause is invalid`);
    failure = { failedAttemptId: failureRecord.failedAttemptId, cause: failureRecord.cause } as const;
  }
  if (record.cleared === true && failure !== null) throw new Error(`${label} cleared result cannot contain failure`);
  return { mode: 'survival', score, cleared: record.cleared, failure };
}

function normalizeSession(rawValue: unknown, legacyValidated: PortableBackupV1['data']['sessions'][number], index: number): QuizSession {
  const raw = requireRecord(rawValue, `Backup.data.sessions[${index}]`);
  const startedAtEpochMs = raw.startedAtEpochMs === undefined
    ? epochFromIso(legacyValidated.startedAt, `Backup.data.sessions[${index}].startedAt`)
    : finiteNumber(raw.startedAtEpochMs, `Backup.data.sessions[${index}].startedAtEpochMs`);
  const endedAtEpochMs = raw.endedAtEpochMs === undefined
    ? legacyValidated.endedAt === null ? null : epochFromIso(legacyValidated.endedAt, `Backup.data.sessions[${index}].endedAt`)
    : nullableFiniteNumber(raw.endedAtEpochMs, `Backup.data.sessions[${index}].endedAtEpochMs`);
  if (endedAtEpochMs !== null && endedAtEpochMs < startedAtEpochMs) throw new Error(`Backup.data.sessions[${index}] end precedes start`);

  const endReason = raw.endReason === undefined ? null : raw.endReason;
  if (!(endReason === null || END_REASONS.has(endReason as SessionEndReason))) throw new Error(`Backup.data.sessions[${index}].endReason is invalid`);
  const targetQuestionCount = raw.targetQuestionCount === undefined ? 0 : finiteNumber(raw.targetQuestionCount, `Backup.data.sessions[${index}].targetQuestionCount`);
  const consumedQuestionCount = raw.consumedQuestionCount === undefined ? 0 : finiteNumber(raw.consumedQuestionCount, `Backup.data.sessions[${index}].consumedQuestionCount`);
  if (!Number.isInteger(targetQuestionCount) || targetQuestionCount < 0) throw new Error(`Backup.data.sessions[${index}].targetQuestionCount is invalid`);
  if (!Number.isInteger(consumedQuestionCount) || consumedQuestionCount < 0 || consumedQuestionCount > targetQuestionCount) throw new Error(`Backup.data.sessions[${index}].consumedQuestionCount is invalid`);
  const modeResult = raw.modeResult === undefined ? null : parseModeResult(raw.modeResult, `Backup.data.sessions[${index}].modeResult`);

  return {
    ...legacyValidated,
    startedAtEpochMs,
    endedAtEpochMs,
    endReason: endReason as SessionEndReason | null,
    targetQuestionCount,
    consumedQuestionCount,
    modeResult,
  };
}

/** Strict envelope/question/common-field validation plus P0 #4 persistence normalization. */
export function parseCompatiblePortableBackup(value: unknown): PortableBackupV1 {
  const projected = projectForLegacyValidation(value);
  const validated = parsePortableBackup(projected);
  const rawRoot = requireRecord(value, 'Backup');
  const rawData = requireRecord(rawRoot.data, 'Backup.data');
  const rawAttempts = requireArray(rawData.attempts, 'Backup.data.attempts');
  const rawSessions = requireArray(rawData.sessions, 'Backup.data.sessions');
  if (rawAttempts.length !== validated.data.attempts.length || rawSessions.length !== validated.data.sessions.length) {
    throw new Error('Backup persistence arrays changed during validation');
  }
  return {
    ...validated,
    data: {
      ...validated.data,
      attempts: validated.data.attempts.map((entry, index) => normalizeAttempt(rawAttempts[index], entry, index)),
      sessions: validated.data.sessions.map((entry, index) => normalizeSession(rawSessions[index], entry, index)),
    },
  };
}
