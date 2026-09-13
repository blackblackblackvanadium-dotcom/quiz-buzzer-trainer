import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { QUALITY_PROFILE_VERSION } from '../../src/domain/types';
import { DB_SCHEMA_VERSION, QbtDatabase } from '../../src/data/db';
import { parseQuestionRecordV1 } from '../../src/data/validation';
import type { LegacyQuestionRecordV1 } from '../../src/data/questionMigration';
import { makeQuestionV1 } from '../fixtures/questionV1';

interface LegacyStoredQuestion extends LegacyQuestionRecordV1 {
  readonly key: string;
}

interface LegacyAttemptRecord {
  readonly attemptId: string;
  readonly questionId: string;
  readonly revisionId: string;
  readonly sessionId: string;
  readonly mode: string;
  readonly outcome: string;
  readonly judgeKind: string | null;
  readonly submittedAnswer: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly buzzIndex: number | null;
  readonly buzzRatio: number | null;
  readonly buzzTimeMs: number | null;
  readonly responseTimeMs: number | null;
  readonly visibleTextAtBuzz: string | null;
}

interface LegacySessionRecord {
  readonly sessionId: string;
  readonly mode: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

class LegacyDatabase extends Dexie {
  questions!: Table<LegacyStoredQuestion, string>;
  attempts!: Table<LegacyAttemptRecord, string>;
  sessions!: Table<LegacySessionRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      questions: '&key, questionId, revisionId, category, pattern, difficulty, *tags',
      attempts: '&attemptId, [questionId+revisionId], questionId, revisionId, sessionId, mode, outcome, completedAt',
      studyStates: '[questionId+revisionId], questionId, revisionId, dueAt',
      sessions: '&sessionId, mode, startedAt, endedAt',
      settings: '&key',
    });
  }
}

class PreConformanceV2Database extends Dexie {
  questions!: Table<Record<string, unknown>, string>;
  attempts!: Table<LegacyAttemptRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(2).stores({
      questions: '&key, questionId, revisionId, revision, classification.genre.primary, metadata.status',
      attempts: '&attemptId, [questionId+revisionId], questionId, revisionId, sessionId, mode, outcome, completedAt',
      studyStates: '[questionId+revisionId], questionId, revisionId, dueAt',
      sessions: '&sessionId, mode, startedAt, endedAt',
      settings: '&key',
    });
  }
}

const databaseNames: string[] = [];

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

function legacyQuestion(overrides: Partial<LegacyStoredQuestion> = {}): LegacyStoredQuestion {
  return {
    key: 'q::r1',
    questionId: 'q',
    revisionId: 'r1',
    prompt: 'abcd',
    canonicalAnswer: 'Answer',
    acceptableAnswers: ['Alias'],
    rejectedAnswers: ['Wrong'],
    category: 'general',
    pattern: 'fact',
    difficulty: 1,
    tags: ['tag-1'],
    advancedBuzzIndex: 1,
    idealBuzzIndex: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function legacyAttempt(questionId = 'q', revisionId = 'r1'): LegacyAttemptRecord {
  return {
    attemptId: 'attempt-1',
    questionId,
    revisionId,
    sessionId: 'session-1',
    mode: 'normal',
    outcome: 'correct',
    judgeKind: 'canonical',
    submittedAnswer: 'Answer',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    buzzIndex: 1,
    buzzRatio: 0.25,
    buzzTimeMs: 100,
    responseTimeMs: 300,
    visibleTextAtBuzz: 'a',
  };
}

function legacySession(): LegacySessionRecord {
  return {
    sessionId: 'session-1',
    mode: 'normal',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:02.000Z',
  };
}

function preConformanceV2Record(): Record<string, unknown> {
  const current = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
  const oldProvenance = { method: 'seed', generator: 'quiz-buzzer-trainer', generatorVersion: 'seed-v1' };
  return {
    ...current,
    key: 'q::r1',
    answers: {
      primaryAnswer: { ...current.answers.primaryAnswer, provenance: oldProvenance },
      acceptedAnswers: current.answers.acceptedAnswers.map((entry) => ({ ...entry, provenance: oldProvenance })),
      rejectedAnswers: current.answers.rejectedAnswers.map((entry) => ({ ...entry, provenance: oldProvenance })),
    },
    classification: {
      ...current.classification,
      genre: { ...current.classification.genre, provenance: oldProvenance },
      questionType: current.classification.questionType === undefined
        ? undefined
        : { ...current.classification.questionType, provenance: oldProvenance },
      difficulty: current.classification.difficulty === undefined
        ? undefined
        : { ...current.classification.difficulty, provenance: oldProvenance },
    },
    determiningPoints: current.determiningPoints.map((point) => ({ ...point, provenance: oldProvenance })),
    derived: {
      ...current.derived,
      exactTextHash: 'legacy-v2-placeholder',
      duplicateDetectionKey: 'legacy-v2-key',
      generatorVersion: 'legacy-v2',
    },
    quality: {
      status: 'valid',
      issues: [],
      lastCheckedAt: current.quality.lastCheckedAt,
    },
  };
}

describe('DB schema migration', () => {
  it('migrates legacy v1 questions and backfills Attempt/Session persistence without losing history', async () => {
    const name = 'qbt-migration-v1-v4';
    databaseNames.push(name);
    const legacy = new LegacyDatabase(name);
    const historicalAttempt = legacyAttempt();
    const historicalSession = legacySession();

    await legacy.open();
    await legacy.questions.add(legacyQuestion());
    await legacy.attempts.add(historicalAttempt);
    await legacy.sessions.add(historicalSession);
    legacy.close();

    const upgraded = new QbtDatabase(name);
    await upgraded.open();

    expect(upgraded.verno).toBe(DB_SCHEMA_VERSION);
    const migratedStored = await upgraded.questions.get('q::r1');
    expect(migratedStored).toBeDefined();
    const { key: _key, ...migrated } = migratedStored!;
    const parsed = parseQuestionRecordV1(migrated);

    expect(parsed).toMatchObject({
      schemaVersion: 1,
      questionId: 'q',
      revisionId: 'r1',
      revision: 1,
      answers: { primaryAnswer: { text: 'Answer', provenance: { method: 'imported' } } },
      quality: { qualityProfileVersion: QUALITY_PROFILE_VERSION },
    });
    expect(parsed.classification.genre.provenance.method).toBe('imported');
    expect(parsed.determiningPoints.map((point) => point.requiredPrefixGraphemes)).toEqual([1, 2]);
    expect(parsed.derived.exactTextHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(parsed.derived.duplicateDetectionKey).toBe('abcd');

    const preservedAttempt = await upgraded.attempts.get('attempt-1');
    expect(preservedAttempt).toMatchObject({
      ...historicalAttempt,
      isCorrect: true,
      startedAtEpochMs: Date.parse(historicalAttempt.startedAt),
      completedAtEpochMs: Date.parse(historicalAttempt.completedAt),
      totalGraphemeCount: null,
      kimari: null,
    });
    const preservedSession = await upgraded.sessions.get('session-1');
    expect(preservedSession).toMatchObject({
      ...historicalSession,
      startedAtEpochMs: Date.parse(historicalSession.startedAt),
      endedAtEpochMs: Date.parse(historicalSession.endedAt!),
      endReason: null,
      targetQuestionCount: 0,
      consumedQuestionCount: 0,
      modeResult: null,
    });
    upgraded.close();
  });

  it('migrates already-deployed DB v2 residual records to canonical v4 without breaking Attempt history', async () => {
    const name = 'qbt-migration-v2-v4';
    databaseNames.push(name);
    const v2 = new PreConformanceV2Database(name);
    const historicalAttempt = legacyAttempt();
    await v2.open();
    await v2.questions.add(preConformanceV2Record());
    await v2.attempts.add(historicalAttempt);
    v2.close();

    const upgraded = new QbtDatabase(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(DB_SCHEMA_VERSION);

    const stored = await upgraded.questions.get('q::r1');
    expect(stored).toBeDefined();
    const { key: _key, ...question } = stored!;
    const parsed = parseQuestionRecordV1(question);
    expect(parsed.answers.primaryAnswer.provenance.method).toBe('human_unverified');
    expect(parsed.classification.genre.provenance.method).toBe('human_unverified');
    expect(parsed.quality.qualityProfileVersion).toBe(QUALITY_PROFILE_VERSION);
    expect(parsed.derived.exactTextHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(parsed.derived.duplicateDetectionKey).toBe('abcd');
    expect(await upgraded.attempts.get('attempt-1')).toMatchObject({
      attemptId: 'attempt-1',
      isCorrect: true,
      kimari: null,
    });
    upgraded.close();
  });

  it('aborts migration when the migrated legacy record fails canonical verification', async () => {
    const name = 'qbt-migration-invalid-v1';
    databaseNames.push(name);
    const legacy = new LegacyDatabase(name);
    await legacy.open();
    await legacy.questions.add(legacyQuestion({ canonicalAnswer: 'bad\u0001answer' }));
    legacy.close();

    const upgraded = new QbtDatabase(name);
    await expect(upgraded.open()).rejects.toThrow('forbidden control character');
    upgraded.close();
  });

  it('aborts migration when two revisions of the same questionId map to the same numeric revision', async () => {
    const name = 'qbt-migration-numeric-revision-collision';
    databaseNames.push(name);
    const legacy = new LegacyDatabase(name);
    await legacy.open();
    await legacy.questions.bulkAdd([
      legacyQuestion({ key: 'q::legacy-a', revisionId: 'legacy-a' }),
      legacyQuestion({ key: 'q::legacy-b', revisionId: 'legacy-b' }),
    ]);
    legacy.close();

    const upgraded = new QbtDatabase(name);
    await expect(upgraded.open()).rejects.toThrow('numeric revision collision');
    upgraded.close();
  });
});
