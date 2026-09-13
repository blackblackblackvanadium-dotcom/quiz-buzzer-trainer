import { QUESTION_SCHEMA_VERSION, type QuestionRecordV1 } from '../../src/domain/types';

const provenance = { method: 'human_verified', confidence: 1, verifiedBy: 'test' } as const;
const timestamp = '2026-01-01T00:00:00.000Z';

function countGraphemes(text: string): number {
  return Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)).length;
}

export function makeQuestionV1(overrides: Partial<QuestionRecordV1> = {}): QuestionRecordV1 {
  const prompt = overrides.prompt ?? 'abcd';
  const base: QuestionRecordV1 = {
    schemaVersion: QUESTION_SCHEMA_VERSION,
    questionId: 'q-1',
    revisionId: 'r1',
    revision: 1,
    prompt,
    answers: {
      primaryAnswer: { id: 'primary', text: 'Answer', provenance },
      acceptedAnswers: [{ id: 'accepted-1', text: 'Alias', relation: 'alias', provenance }],
      rejectedAnswers: [{ id: 'rejected-1', text: 'Wrong', rejectionReason: 'incorrect', provenance }],
    },
    classification: {
      genre: { primary: 'general', taxonomyVersion: 'genre-v1', provenance },
      questionType: { code: 'fact', taxonomyVersion: 'type-v1', provenance },
      tags: [{ id: 'tag-1' }],
      difficulty: { value: 1, scale: 'test-1-5', provenance },
    },
    determiningPoints: [{
      id: 'dp-1',
      method: 'human_semantic',
      requiredPrefixGraphemes: Math.min(2, countGraphemes(prompt)),
      confidence: 1,
      provenance,
    }],
    sources: [{ id: 'source-1', role: 'fact_verification', title: 'Test source' }],
    derived: {
      graphemeCount: countGraphemes(prompt),
      graphemeProfile: 'Intl.Segmenter:ja:grapheme',
      exactTextHash: 'test-exact-text-hash',
      duplicateDetectionKey: `test:${prompt}`,
      computedAt: timestamp,
      generatorVersion: 'test-v1',
    },
    quality: {
      status: 'valid',
      issues: [],
      lastCheckedAt: timestamp,
      qualityProfileVersion: 'test-v1',
    },
    metadata: {
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'active',
    },
  };
  return { ...base, ...overrides };
}

export const validQuestionV1 = makeQuestionV1();
