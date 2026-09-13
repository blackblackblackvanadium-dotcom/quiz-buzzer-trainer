import { afterEach, describe, expect, it } from 'vitest';
import type { Attempt, QuestionDatasetV1, QuestionRecordV1 } from '../../src/domain/types';
import { QbtDatabase } from '../../src/data/db';
import { importQuestionDataset } from '../../src/data/questionImport';
import { QuestionRepository } from '../../src/data/repositories';
import { makeQuestionV1 } from '../fixtures/questionV1';

const databases: QbtDatabase[] = [];
const CHECKED_AT = '2026-09-13T00:00:00.000Z';

function createDatabase(name: string): QbtDatabase {
  const database = new QbtDatabase(name);
  databases.push(database);
  return database;
}

function dataset(questions: readonly QuestionRecordV1[]): QuestionDatasetV1 {
  return {
    schemaVersion: 1,
    format: 'qbt-question-dataset',
    datasetId: 'dataset-1',
    datasetVersion: 'v1',
    exportedAt: CHECKED_AT,
    generator: { name: 'test', version: '1' },
    questions,
  };
}

function historicalAttempt(questionId = 'q', revisionId = 'r1'): Attempt {
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

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe('Question dataset import modes', () => {
  it('insert_only validates, recomputes derived fields, records quality warnings, then inserts atomically', async () => {
    const database = createDatabase('qbt-import-insert-only');
    const stale = makeQuestionV1({
      questionId: 'q',
      revisionId: 'r1',
      revision: 1,
      derived: {
        ...makeQuestionV1().derived,
        exactTextHash: 'stale',
        duplicateDetectionKey: 'stale',
      },
    });

    const result = await importQuestionDataset(dataset([stale]), 'insert_only', database, CHECKED_AT);
    expect(result).toMatchObject({ mode: 'insert_only', inserted: 1, skipped: 0, replaced: 0 });
    expect(result.issues.map((item) => item.issue.code)).toEqual(expect.arrayContaining([
      'derived_exact_text_hash_mismatch',
      'derived_duplicate_key_mismatch',
    ]));

    const stored = await new QuestionRepository(database).list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.derived.exactTextHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(stored[0]?.quality.status).toBe('warning');
  });

  it('insert_only rejects an existing immutable revision without changing stored data', async () => {
    const database = createDatabase('qbt-import-insert-conflict');
    const repository = new QuestionRepository(database);
    const original = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    await repository.putMany([original]);

    await expect(importQuestionDataset(dataset([original]), 'insert_only', database, CHECKED_AT)).rejects.toThrow('immutable');
    expect(await repository.count()).toBe(1);
  });

  it('merge skips an existing revision and inserts only a new revision without overwriting history', async () => {
    const database = createDatabase('qbt-import-merge');
    const repository = new QuestionRepository(database);
    const r1 = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    const r2 = makeQuestionV1({ questionId: 'q', revisionId: 'r2', revision: 2 });
    await repository.putMany([r1]);

    const result = await importQuestionDataset(dataset([r1, r2]), 'merge', database, CHECKED_AT);
    expect(result).toMatchObject({ mode: 'merge', inserted: 1, skipped: 1, replaced: 0 });
    const stored = await repository.list();
    expect(stored.map((question) => question.revisionId).sort()).toEqual(['r1', 'r2']);
  });

  it('merge rejects a numeric revision collision with a different revisionId', async () => {
    const database = createDatabase('qbt-import-merge-numeric');
    const repository = new QuestionRepository(database);
    await repository.putMany([makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 })]);

    await expect(importQuestionDataset(dataset([
      makeQuestionV1({ questionId: 'q', revisionId: 'alternate', revision: 1 }),
    ]), 'merge', database, CHECKED_AT)).rejects.toThrow('numeric revision');
    expect(await repository.count()).toBe(1);
  });

  it('restore replaces only Questions while preserving Attempt history when all references remain resolvable', async () => {
    const database = createDatabase('qbt-import-restore');
    const repository = new QuestionRepository(database);
    const r1 = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    const oldOther = makeQuestionV1({ questionId: 'old', revisionId: 'r1', revision: 1 });
    const r2 = makeQuestionV1({ questionId: 'q', revisionId: 'r2', revision: 2 });
    await repository.putMany([r1, oldOther]);
    const attempt = historicalAttempt();
    await database.attempts.add(attempt);

    const result = await importQuestionDataset(dataset([r1, r2]), 'restore', database, CHECKED_AT);
    expect(result).toMatchObject({ mode: 'restore', inserted: 2, skipped: 0, replaced: 2 });
    expect((await repository.list()).map((question) => question.revisionId).sort()).toEqual(['r1', 'r2']);
    expect(await database.attempts.get(attempt.attemptId)).toEqual(attempt);
  });

  it('restore rejects atomically when it would orphan an existing Attempt revision reference', async () => {
    const database = createDatabase('qbt-import-restore-orphan');
    const repository = new QuestionRepository(database);
    const r1 = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    const r2 = makeQuestionV1({ questionId: 'q', revisionId: 'r2', revision: 2 });
    await repository.putMany([r1]);
    await database.attempts.add(historicalAttempt());

    await expect(importQuestionDataset(dataset([r2]), 'restore', database, CHECKED_AT)).rejects.toThrow('orphan');
    const stored = await repository.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.revisionId).toBe('r1');
    expect(await database.attempts.count()).toBe(1);
  });
});
