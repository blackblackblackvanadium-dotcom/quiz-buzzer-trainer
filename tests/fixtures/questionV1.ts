import {
  QUESTION_SCHEMA_VERSION,
  QUALITY_PROFILE_VERSION,
  type QuestionRecordV1,
} from '../../src/domain/types';
import { computeDerivedQuestionData } from '../../src/data/questionIntegrity';

export const QUESTION_V1_TEST_TIMESTAMP = '2026-01-01T00:00:00.000Z';
export const TEST_PROVENANCE = { method: 'human_verified', confidence: 1, verifiedBy: 'test' } as const;

export function makeQuestionV1(overrides: Partial<QuestionRecordV1> = {}): QuestionRecordV1 {
  const prompt = overrides.prompt ?? 'abcd';
  const base: QuestionRecordV1 = {
    schemaVersion: QUESTION_SCHEMA_VERSION,
    questionId: 'q-1',
    revisionId: 'r1',
    revision: 1,
    prompt,
    answers: {
      primaryAnswer: { id: 'primary', text: 'Answer', provenance: TEST_PROVENANCE },
      acceptedAnswers: [{ id: 'accepted-1', text: 'Alias', relation: 'alias', provenance: TEST_PROVENANCE }],
      rejectedAnswers: [{ id: 'rejected-1', text: 'Wrong', rejectionReason: 'incorrect', provenance: TEST_PROVENANCE }],
    },
    classification: {
      genre: { primary: 'general', taxonomyVersion: 'genre-v1', provenance: TEST_PROVENANCE },
      questionType: { code: 'fact', taxonomyVersion: 'type-v1', provenance: TEST_PROVENANCE },
      tags: [{ id: 'tag-1' }],
      difficulty: { value: 1, scale: 'test-1-5', provenance: TEST_PROVENANCE },
    },
    determiningPoints: [{
      id: 'dp-1',
      method: 'human_semantic',
      requiredPrefixGraphemes: Math.min(2, computeDerivedQuestionData(prompt, QUESTION_V1_TEST_TIMESTAMP).graphemeCount),
      confidence: 1,
      provenance: TEST_PROVENANCE,
    }],
    sources: [{ id: 'source-1', role: 'fact_verification', title: 'Test source' }],
    derived: computeDerivedQuestionData(prompt, QUESTION_V1_TEST_TIMESTAMP),
    quality: {
      status: 'valid',
      issues: [],
      lastCheckedAt: QUESTION_V1_TEST_TIMESTAMP,
      qualityProfileVersion: QUALITY_PROFILE_VERSION,
    },
    metadata: {
      createdAt: QUESTION_V1_TEST_TIMESTAMP,
      updatedAt: QUESTION_V1_TEST_TIMESTAMP,
      status: 'active',
    },
  };
  return { ...base, ...overrides };
}

export const validQuestionV1 = makeQuestionV1();
