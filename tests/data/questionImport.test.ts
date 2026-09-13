import { afterEach, describe, expect, it } from 'vitest';
import type { Attempt, QuestionDatasetV1, QuestionRecordV1 } from '../../src/domain/types';
import { QbtDatabase } from '../../src/data/db';
import {
  importQuestionDatasetCsv,
  importQuestionDatasetJson,
} from '../../src/data/questionImport';
import { serializeQuestionDataset } from '../../src/data/questionDataset';
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

function datasetJson(questions: readonly QuestionRecordV1[]): string {
  return serializeQuestionDataset(dataset(questions));
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

const CSV_HEADER = [
  'questionId', 'revisionId', 'revision', 'prompt', 'answersJson', 'classificationJson',
  'determiningPointsJson', 'sourcesJson', 'derivedJson', 'qualityJson', 'metadataJson', 'extensionsJson',
];

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvFixture(question: QuestionRecordV1): string {
  const row = [
    question.questionId,
    question.revisionId,
    String(question.revision),
    question.prompt,
    JSON.stringify(question.answers),
    JSON.stringify(question.classification),
    JSON.stringify(question.determiningPoints),
    JSON.stringify(question.sources),
    JSON.stringify(question.derived),
    JSON.stringify(question.quality),
    JSON.stringify(question.metadata),
    question.extensions === undefined ? '' : JSON.stringify(question.extensions),
  ];
  return `${CSV_HEADER.join(',')}\n${row.map(csvCell).join(',')}\n`;
}

const csvMetadata = {
  datasetId: 'csv-dataset',
  datasetVersion: 'v1',
  exportedAt: CHECKED_AT,
  generator: { name: 'test', version: '1' },
};

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

    const result = await importQuestionDatasetJson(datasetJson([stale]), 'insert_only', database, CHECKED_AT);
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

  it('blocks an error-severity quality issue before any DB commit', async () => {
    const database = createDatabase('qbt-import-quality-error');
    const invalidQuality = makeQuestionV1({
      questionId: 'q',
      revisionId: 'r1',
      revision: 1,
      quality: {
        status: 'error',
        issues: [{ code: 'authoritative_error', severity: 'error', message: 'Do not import.' }],
        qualityProfileVersion: 'qbt-quality-v1',
      },
    });

    await expect(
      importQuestionDatasetJson(datasetJson([invalidQuality]), 'insert_only', database, CHECKED_AT),
    ).rejects.toThrow('quality error');
    expect(await database.questions.count()).toBe(0);
  });

  it('insert_only rejects an existing immutable questionId+revisionId without changing stored data', async () => {
    const database = createDatabase('qbt-import-insert-conflict');
    const repository = new QuestionRepository(database);
    const original = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    await repository.putMany([original]);

    await expect(
      importQuestionDatasetJson(datasetJson([original]), 'insert_only', database, CHECKED_AT),
    ).rejects.toThrow('immutable');
    expect(await repository.count()).toBe(1);
  });

  it('allows the same revisionId under different questionIds because identity is questionId+revisionId', async () => {
    const database = createDatabase('qbt-import-composite-identity');
    const result = await importQuestionDatasetJson(datasetJson([
      makeQuestionV1({ questionId: 'q1', revisionId: 'r1', revision: 1 }),
      makeQuestionV1({ questionId: 'q2', revisionId: 'r1', revision: 1 }),
    ]), 'insert_only', database, CHECKED_AT);
    expect(result.inserted).toBe(2);
    expect(await database.questions.count()).toBe(2);
  });

  it('merge treats an identical existing revision as an idempotent no-op and inserts only new revisions', async () => {
    const database = createDatabase('qbt-import-merge');
    const repository = new QuestionRepository(database);
    const r1 = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    const r2 = makeQuestionV1({ questionId: 'q', revisionId: 'r2', revision: 2 });
    await repository.putMany([r1]);

    const result = await importQuestionDatasetJson(datasetJson([r1, r2]), 'merge', database, CHECKED_AT);
    expect(result).toMatchObject({ mode: 'merge', inserted: 1, skipped: 1, replaced: 0 });
    const stored = await repository.list();
    expect(stored.map((question) => question.revisionId).sort()).toEqual(['r1', 'r2']);
  });

  it('merge rejects the same revision identity with different revision-defining content', async () => {
    const database = createDatabase('qbt-import-merge-immutable');
    const repository = new QuestionRepository(database);
    const original = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    await repository.putMany([original]);
    const changed = makeQuestionV1({
      questionId: 'q',
      revisionId: 'r1',
      revision: 1,
      prompt: 'different prompt',
    });

    await expect(
      importQuestionDatasetJson(datasetJson([changed]), 'merge', database, CHECKED_AT),
    ).rejects.toThrow('REVISION_IMMUTABILITY_VIOLATION');
    expect((await repository.list())[0]?.prompt).toBe(original.prompt);
  });

  it('merge rejects a numeric revision collision with a different revisionId', async () => {
    const database = createDatabase('qbt-import-merge-numeric');
    const repository = new QuestionRepository(database);
    await repository.putMany([makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 })]);

    await expect(importQuestionDatasetJson(datasetJson([
      makeQuestionV1({ questionId: 'q', revisionId: 'alternate', revision: 1 }),
    ]), 'merge', database, CHECKED_AT)).rejects.toThrow('numeric revision');
    expect(await repository.count()).toBe(1);
  });

  it('restore replaces only Questions while preserving Attempt history when references and immutable revisions remain valid', async () => {
    const database = createDatabase('qbt-import-restore');
    const repository = new QuestionRepository(database);
    const r1 = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    const oldOther = makeQuestionV1({ questionId: 'old', revisionId: 'r1', revision: 1 });
    const r2 = makeQuestionV1({ questionId: 'q', revisionId: 'r2', revision: 2 });
    await repository.putMany([r1, oldOther]);
    const attempt = historicalAttempt('q', 'r1');
    await database.attempts.add(attempt);

    const result = await importQuestionDatasetJson(datasetJson([r1, r2]), 'restore', database, CHECKED_AT);
    expect(result).toMatchObject({ mode: 'restore', inserted: 2, skipped: 0, replaced: 2 });
    expect((await repository.list()).map((question) => question.revisionId).sort()).toEqual(['r1', 'r2']);
    expect(await database.attempts.get(attempt.attemptId)).toEqual(attempt);
  });

  it('restore rejects different content for an existing revision identity', async () => {
    const database = createDatabase('qbt-import-restore-immutable');
    const repository = new QuestionRepository(database);
    const original = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    await repository.putMany([original]);
    const changed = makeQuestionV1({
      questionId: 'q',
      revisionId: 'r1',
      revision: 1,
      answers: {
        ...original.answers,
        primaryAnswer: { ...original.answers.primaryAnswer, text: 'Changed' },
      },
    });

    await expect(
      importQuestionDatasetJson(datasetJson([changed]), 'restore', database, CHECKED_AT),
    ).rejects.toThrow('REVISION_IMMUTABILITY_VIOLATION');
    expect((await repository.list())[0]?.answers.primaryAnswer.text).toBe('Answer');
  });

  it('restore rejects atomically when it would orphan an existing Attempt revision reference', async () => {
    const database = createDatabase('qbt-import-restore-orphan');
    const repository = new QuestionRepository(database);
    const r1 = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    const r2 = makeQuestionV1({ questionId: 'q', revisionId: 'r2', revision: 2 });
    await repository.putMany([r1]);
    await database.attempts.add(historicalAttempt('q', 'r1'));

    await expect(
      importQuestionDatasetJson(datasetJson([r2]), 'restore', database, CHECKED_AT),
    ).rejects.toThrow('orphan');
    const stored = await repository.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.revisionId).toBe('r1');
    expect(await database.attempts.count()).toBe(1);
  });

  it('accepts CSV for insert/merge but explicitly prohibits CSV restore', async () => {
    const database = createDatabase('qbt-import-csv');
    const question = makeQuestionV1({ questionId: 'csv-q', revisionId: 'r1', revision: 1 });
    const csv = csvFixture(question);

    const inserted = await importQuestionDatasetCsv(csv, csvMetadata, 'insert_only', database, CHECKED_AT);
    expect(inserted.inserted).toBe(1);
    await expect(
      importQuestionDatasetCsv(csv, csvMetadata, 'restore', database, CHECKED_AT),
    ).rejects.toThrow('CSV restore is prohibited');
  });
});
