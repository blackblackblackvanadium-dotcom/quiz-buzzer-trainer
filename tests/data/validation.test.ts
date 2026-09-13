import { describe, expect, it } from 'vitest';
import { parseQuestionDatasetV1, parseQuestionRecordV1 } from '../../src/data/validation';
import { makeQuestionV1, validQuestionV1 } from '../fixtures/questionV1';

function dataset(question = validQuestionV1) {
  return {
    schemaVersion: 1,
    format: 'qbt-question-dataset',
    datasetId: 'dataset-1',
    datasetVersion: '2026-09-13',
    exportedAt: '2026-09-13T00:00:00.000Z',
    generator: { name: 'test', version: '1' },
    questions: [question],
  };
}

describe('Question Schema v1 runtime validation', () => {
  it('accepts the canonical Schema v1 fixture', () => {
    const parsed = parseQuestionRecordV1(validQuestionV1);
    expect(parsed).toMatchObject({ schemaVersion: 1, questionId: 'q-1', revisionId: 'r1', revision: 1 });
    expect(parsed.answers.primaryAnswer.text).toBe('Answer');
  });

  it('accepts the canonical QuestionDatasetV1 envelope', () => {
    expect(parseQuestionDatasetV1(dataset()).questions).toHaveLength(1);
  });

  it('rejects unknown/future Question schema versions', () => {
    expect(() => parseQuestionRecordV1({ ...validQuestionV1, schemaVersion: 2 })).toThrow('Unsupported Question schemaVersion');
  });

  it('rejects unknown/future dataset schema versions', () => {
    expect(() => parseQuestionDatasetV1({ ...dataset(), schemaVersion: 2 })).toThrow('Unsupported Question dataset');
  });

  const negativeMatrix: readonly [string, unknown][] = [
    [
      'primary/accepted normalized collision',
      makeQuestionV1({
        answers: {
          ...validQuestionV1.answers,
          acceptedAnswers: [{ id: 'accepted-1', text: ' A-n-s-w-e-r ', relation: 'alias', provenance: { method: 'test' } }],
        },
      }),
    ],
    [
      'accepted/rejected normalized collision',
      makeQuestionV1({
        answers: {
          ...validQuestionV1.answers,
          acceptedAnswers: [{ id: 'accepted-1', text: 'same', provenance: { method: 'test' } }],
          rejectedAnswers: [{ id: 'rejected-1', text: 'same', rejectionReason: 'incorrect', provenance: { method: 'test' } }],
        },
      }),
    ],
    [
      'determining point beyond prompt',
      makeQuestionV1({
        determiningPoints: [{ id: 'too-late', method: 'human_semantic', requiredPrefixGraphemes: 999, provenance: { method: 'test' } }],
      }),
    ],
    [
      'dataset uniqueness without scope',
      makeQuestionV1({
        determiningPoints: [{ id: 'dataset', method: 'dataset_uniqueness', requiredPrefixGraphemes: 1, provenance: { method: 'test' } }],
      }),
    ],
    [
      'unknown provenance source reference',
      makeQuestionV1({
        answers: {
          ...validQuestionV1.answers,
          primaryAnswer: { id: 'primary', text: 'Answer', provenance: { method: 'test', sourceIds: ['missing-source'] } },
        },
      }),
    ],
    [
      'derived grapheme count mismatch',
      makeQuestionV1({ derived: { ...validQuestionV1.derived, graphemeCount: 999 } }),
    ],
    [
      'metadata updated before created',
      makeQuestionV1({
        metadata: {
          ...validQuestionV1.metadata,
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    ],
    [
      'valid quality with error issue',
      makeQuestionV1({
        quality: {
          status: 'valid',
          issues: [{ code: 'broken', severity: 'error', message: 'broken' }],
        },
      }),
    ],
  ];

  it.each(negativeMatrix)('rejects cross-field violation: %s', (_label, value) => {
    expect(() => parseQuestionRecordV1(value)).toThrow();
  });

  it('rejects duplicate questionId+revisionId pairs inside a dataset', () => {
    expect(() => parseQuestionDatasetV1({ ...dataset(), questions: [validQuestionV1, validQuestionV1] })).toThrow('duplicate');
  });
});
