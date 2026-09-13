import { describe, expect, it } from 'vitest';
import type { QuestionDatasetV1, QuestionRecordV1 } from '../../src/domain/types';
import {
  parseQuestionDatasetCsv,
  parseQuestionDatasetJson,
  serializeQuestionDataset,
} from '../../src/data/questionDataset';
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

const csvMetadata = {
  datasetId: dataset.datasetId,
  datasetVersion: dataset.datasetVersion,
  exportedAt: dataset.exportedAt,
  generator: dataset.generator,
};

const CSV_HEADER = [
  'questionId', 'revisionId', 'revision', 'prompt', 'answersJson', 'classificationJson',
  'determiningPointsJson', 'sourcesJson', 'derivedJson', 'qualityJson', 'metadataJson', 'extensionsJson',
];

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Test fixture builder only; the production contract intentionally has no CSV exporter. */
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

describe('Question dataset import/export contract', () => {
  it('round-trips the canonical JSON export format', () => {
    expect(parseQuestionDatasetJson(serializeQuestionDataset(dataset))).toEqual(dataset);
  });

  it('accepts canonical questions through the auxiliary import-only CSV format', () => {
    const csv = csvFixture(validQuestionV1);
    const parsed = parseQuestionDatasetCsv(csv, csvMetadata);
    expect(parsed).toEqual(dataset);
    expect(csv.split('\n')[0]).toContain('answersJson');
  });

  it('handles commas, quotes, and newlines in CSV input', () => {
    const complex = { ...validQuestionV1, prompt: 'A,"B"\nC' };
    const csv = csvFixture(complex);
    expect(parseQuestionDatasetCsv(csv, csvMetadata).questions[0]?.prompt).toBe('A,"B"\nC');
  });

  it('rejects a malformed CSV header and invalid revision values', () => {
    expect(() => parseQuestionDatasetCsv('wrong\n', csvMetadata)).toThrow('header');
    const csv = csvFixture(validQuestionV1).replace(',1,abcd,', ',0,abcd,');
    expect(() => parseQuestionDatasetCsv(csv, csvMetadata)).toThrow('positive integer');
  });

  it('rejects a future dataset schema version deterministically', () => {
    expect(() => parseQuestionDatasetV1({ ...dataset, schemaVersion: 2 })).toThrow('Unsupported Question dataset');
  });

  it('does not treat an App Backup envelope as a Question dataset', () => {
    expect(() => parseQuestionDatasetV1({ format: 'qbt-backup', version: 1 })).toThrow();
  });

  it('does not treat a Question dataset as an App Backup envelope', () => {
    expect(() => parsePortableBackup(dataset)).toThrow();
  });
});
