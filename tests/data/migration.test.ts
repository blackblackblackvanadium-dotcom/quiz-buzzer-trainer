import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { QUALITY_PROFILE_VERSION, type Attempt } from '../../src/domain/types';
import { DB_SCHEMA_VERSION, QbtDatabase } from '../../src/data/db';
import { parseQuestionRecordV1 } from '../../src/data/validation';
import type { LegacyQuestionRecordV1 } from '../../src/data/questionMigration';

interface LegacyStoredQuestion extends LegacyQuestionRecordV1 {
  readonly key: string;
}

class LegacyDatabase extends Dexie {
  questions!: Table<LegacyStoredQuestion, string>;
  attempts!: Table<Attempt, string>;

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

function attempt(): Attempt {
  return {
    attemptId: 'attempt-1',
    questionId: 'q',
    revisionId: 'r1',
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

describe('DB schema migration', () => {
  it('migrates legacy questions with canonical provenance/derived/quality and preserves Attempt history', async () => {
    const name = 'qbt-migration-v1-v2';
    databaseNames.push(name);
    const legacy = new LegacyDatabase(name);
    const historicalAttempt = attempt();

    await legacy.open();
    await legacy.questions.add(legacyQuestion());
    await legacy.attempts.add(historicalAttempt);
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
    expect(preservedAttempt).toEqual(historicalAttempt);
    expect(preservedAttempt?.questionId).toBe('q');
    expect(preservedAttempt?.revisionId).toBe('r1');
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
});
