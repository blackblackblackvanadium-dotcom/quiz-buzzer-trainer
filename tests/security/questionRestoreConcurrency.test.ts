import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionDatasetV1 } from '../../src/domain/types';
import { getDatabaseGeneration } from '../../src/data/concurrency';
import { QbtDatabase } from '../../src/data/db';
import { importQuestionDatasetJson } from '../../src/data/questionImport';
import { serializeQuestionDataset } from '../../src/data/questionDataset';
import { QuestionRepository } from '../../src/data/repositories';
import { makeQuestionV1 } from '../fixtures/questionV1';

const databases: QbtDatabase[] = [];

function database(name: string): QbtDatabase {
  const value = new QbtDatabase(name);
  databases.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (value) => {
    value.close();
    await value.delete();
  }));
  localStorage.clear();
});

describe('P0 #7 Question restore multi-tab invalidation', () => {
  it('advances the database generation only after a successful destructive Question restore', async () => {
    const db = database('qbt-p0-7-question-restore-generation');
    const repository = new QuestionRepository(db);
    const original = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    await repository.putMany([original]);

    const dataset: QuestionDatasetV1 = {
      schemaVersion: 1,
      format: 'qbt-question-dataset',
      datasetId: 'restore-security',
      datasetVersion: '1',
      exportedAt: '2026-09-14T00:00:00.000Z',
      generator: { name: 'test', version: '1' },
      questions: [original],
    };
    const before = getDatabaseGeneration();

    await importQuestionDatasetJson(
      serializeQuestionDataset(dataset),
      'restore',
      db,
      '2026-09-14T00:00:00.000Z',
    );

    expect(getDatabaseGeneration()).not.toBe(before);
    expect(await repository.count()).toBe(1);
  });
});
