import { describe, expect, it } from 'vitest';
import type { QuestionDatasetV1 } from '../../src/domain/types';
import { parseQuestionDatasetJson, serializeQuestionDataset } from '../../src/data/questionDataset';
import { parsePortableBackup, parseQuestionDatasetV1 } from '../../src/data/validation';
import { validQuestionV1 } from '../fixtures/questionV1';

const dataset: QuestionDatasetV1 = {
  schemaVersion: 1,
  format: 'qbt-question-dataset',
  datasetId: 'dataset-1',
  datasetVersion: 'v1',
  exportedAt: '2026-09-13T00:00:00.000Z',
  generator: { name: 'test', version: '1' },
  questions: [validQuestionV1],
};

describe('Question dataset import/export contract', () => {
  it('round-trips canonical QuestionDatasetV1 JSON', () => {
    expect(parseQuestionDatasetJson(serializeQuestionDataset(dataset))).toEqual(dataset);
  });

  it('rejects a future dataset schema version deterministically', () => {
    expect(() => parseQuestionDatasetV1({ ...dataset, schemaVersion: 2 })).toThrow('Unsupported Question dataset');
  });

  it('does not treat an App Backup envelope as a Question dataset', () => {
    expect(() => parseQuestionDatasetV1({ format: 'qbt-backup', version: 1 })).toThrow('Unsupported Question dataset');
  });

  it('does not treat a Question dataset as an App Backup envelope', () => {
    expect(() => parsePortableBackup(dataset)).toThrow('Unsupported backup format/version');
  });
});
