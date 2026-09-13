import { describe, expect, it } from 'vitest';
import { QUALITY_PROFILE_VERSION } from '../../src/domain/types';
import {
  parseQuestionDatasetV1,
  parseQuestionRecordV1,
  prepareQuestionRecordV1,
} from '../../src/data/validation';
import { makeQuestionV1, QUESTION_V1_TEST_TIMESTAMP, TEST_PROVENANCE, validQuestionV1 } from '../fixtures/questionV1';

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
    expect(parsed.quality.qualityProfileVersion).toBe(QUALITY_PROFILE_VERSION);
  });

  it('accepts the canonical QuestionDatasetV1 envelope', () => {
    expect(parseQuestionDatasetV1(dataset()).questions).toHaveLength(1);
  });

  it('rejects unknown/future Question and dataset schema versions', () => {
    expect(() => parseQuestionRecordV1({ ...validQuestionV1, schemaVersion: 2 })).toThrow('Unsupported Question schemaVersion');
    expect(() => parseQuestionDatasetV1({ ...dataset(), schemaVersion: 2 })).toThrow('Unsupported Question dataset');
  });

  const negativeMatrix: readonly [string, unknown][] = [
    [
      'accepted/rejected normalized collision',
      makeQuestionV1({
        answers: {
          ...validQuestionV1.answers,
          acceptedAnswers: [{ id: 'accepted-1', text: 'same', provenance: TEST_PROVENANCE }],
          rejectedAnswers: [{ id: 'rejected-1', text: 'same', rejectionReason: 'incorrect', provenance: TEST_PROVENANCE }],
        },
      }),
    ],
    [
      'determining point beyond prompt',
      makeQuestionV1({
        determiningPoints: [{ id: 'too-late', method: 'human_semantic', requiredPrefixGraphemes: 999, provenance: TEST_PROVENANCE }],
      }),
    ],
    [
      'dataset uniqueness without scope',
      makeQuestionV1({
        determiningPoints: [{ id: 'dataset', method: 'dataset_uniqueness', requiredPrefixGraphemes: 1, provenance: TEST_PROVENANCE }],
      }),
    ],
    [
      'unknown provenance source reference',
      makeQuestionV1({
        answers: {
          ...validQuestionV1.answers,
          primaryAnswer: { id: 'primary', text: 'Answer', provenance: { ...TEST_PROVENANCE, sourceIds: ['missing-source'] } },
        },
      }),
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
          qualityProfileVersion: QUALITY_PROFILE_VERSION,
        },
      }),
    ],
    [
      'non-canonical provenance method',
      {
        ...validQuestionV1,
        answers: {
          ...validQuestionV1.answers,
          primaryAnswer: { ...validQuestionV1.answers.primaryAnswer, provenance: { method: 'seed' } },
        },
      },
    ],
    [
      'missing qualityProfileVersion',
      {
        ...validQuestionV1,
        quality: { status: 'valid', issues: [] },
      },
    ],
    [
      'unknown top-level field',
      { ...validQuestionV1, unexpected: true },
    ],
    [
      'unknown nested field',
      {
        ...validQuestionV1,
        answers: {
          ...validQuestionV1.answers,
          primaryAnswer: { ...validQuestionV1.answers.primaryAnswer, unexpected: true },
        },
      },
    ],
    [
      'lone high surrogate',
      makeQuestionV1({ prompt: `bad\ud800text` }),
    ],
    [
      'forbidden control character',
      makeQuestionV1({
        answers: {
          ...validQuestionV1.answers,
          primaryAnswer: { ...validQuestionV1.answers.primaryAnswer, text: 'bad\u0001answer' },
        },
      }),
    ],
  ];

  it.each(negativeMatrix)('rejects ERROR condition: %s', (_label, value) => {
    expect(() => parseQuestionRecordV1(value)).toThrow();
  });

  it('treats primary/accepted and within-list duplicates as WARNING rather than parser errors', () => {
    const duplicate = makeQuestionV1({
      answers: {
        primaryAnswer: { id: 'primary', text: 'Answer', provenance: TEST_PROVENANCE },
        acceptedAnswers: [
          { id: 'accepted-1', text: ' A-n-s-w-e-r ', provenance: TEST_PROVENANCE },
          { id: 'accepted-2', text: 'Alias', provenance: TEST_PROVENANCE },
          { id: 'accepted-3', text: 'A-l-i-a-s', provenance: TEST_PROVENANCE },
        ],
        rejectedAnswers: [
          { id: 'rejected-1', text: 'Wrong', rejectionReason: 'incorrect', provenance: TEST_PROVENANCE },
          { id: 'rejected-2', text: 'W-r-o-n-g', rejectionReason: 'incorrect', provenance: TEST_PROVENANCE },
        ],
      },
    });

    expect(() => parseQuestionRecordV1(duplicate)).not.toThrow();
    const prepared = prepareQuestionRecordV1(duplicate, QUESTION_V1_TEST_TIMESTAMP);
    expect(prepared.quality.status).toBe('warning');
    expect(prepared.quality.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'duplicate_primary_accepted',
      'duplicate_accepted_answer',
      'duplicate_rejected_answer',
    ]));
  });

  it('recomputes derived fields and records imported mismatches as quality warnings', () => {
    const stale = makeQuestionV1({
      derived: {
        ...validQuestionV1.derived,
        graphemeCount: 999,
        exactTextHash: 'stale-hash',
        duplicateDetectionKey: 'stale-key',
      },
    });
    expect(() => parseQuestionRecordV1(stale)).not.toThrow();

    const prepared = prepareQuestionRecordV1(stale, '2026-09-13T00:00:00.000Z');
    expect(prepared.derived.graphemeCount).toBe(4);
    expect(prepared.derived.exactTextHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(prepared.derived.duplicateDetectionKey).toBe('abcd');
    expect(prepared.quality.status).toBe('warning');
    expect(prepared.quality.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'derived_grapheme_count_mismatch',
      'derived_exact_text_hash_mismatch',
      'derived_duplicate_key_mismatch',
    ]));
  });

  it('rejects duplicate questionId+revisionId pairs inside a dataset', () => {
    expect(() => parseQuestionDatasetV1({ ...dataset(), questions: [validQuestionV1, validQuestionV1] })).toThrow('duplicate');
  });

  it('rejects duplicate numeric revision values for the same questionId even with different revisionId', () => {
    const second = makeQuestionV1({ questionId: validQuestionV1.questionId, revisionId: 'other-id', revision: 1 });
    expect(() => parseQuestionDatasetV1({ ...dataset(), questions: [validQuestionV1, second] })).toThrow('numeric revisions');
  });

  it('allows LF/TAB/CR while rejecting forbidden controls', () => {
    const withAllowedWhitespace = makeQuestionV1({ prompt: 'a\tb\nc\rd' });
    expect(() => parseQuestionRecordV1(withAllowedWhitespace)).not.toThrow();
  });
});
