import {
  QUESTION_SCHEMA_VERSION,
  QUALITY_PROFILE_VERSION,
  type QuestionRevision,
} from '../domain/types';
import { computeDerivedQuestionData } from './questionIntegrity';

const CREATED_AT = '2026-09-13T00:00:00.000Z';
const provenance = {
  method: 'human_unverified' as const,
  generator: 'quiz-buzzer-trainer',
  generatorVersion: 'seed-v2',
} as const;

function makeSeedQuestion(input: {
  questionId: string;
  prompt: string;
  primaryAnswer: string;
  acceptedAnswers?: readonly string[];
  rejectedAnswers?: readonly string[];
  genre: string;
  questionType: string;
  difficulty: number;
  tags: readonly string[];
  determiningPoints?: readonly { id: string; requiredPrefixGraphemes: number }[];
}): QuestionRevision {
  return {
    schemaVersion: QUESTION_SCHEMA_VERSION,
    questionId: input.questionId,
    revisionId: 'r1',
    revision: 1,
    prompt: input.prompt,
    answers: {
      primaryAnswer: { id: 'primary', text: input.primaryAnswer, provenance },
      acceptedAnswers: (input.acceptedAnswers ?? []).map((text, index) => ({
        id: `accepted-${index + 1}`,
        text,
        relation: 'other',
        provenance,
      })),
      rejectedAnswers: (input.rejectedAnswers ?? []).map((text, index) => ({
        id: `rejected-${index + 1}`,
        text,
        rejectionReason: 'other',
        provenance,
      })),
    },
    classification: {
      genre: { primary: input.genre, taxonomyVersion: 'seed-v1', provenance },
      questionType: { code: input.questionType, taxonomyVersion: 'seed-v1', provenance },
      tags: input.tags.map((id) => ({ id })),
      difficulty: { value: input.difficulty, scale: 'seed-1-5', provenance },
    },
    determiningPoints: (input.determiningPoints ?? []).map((point) => ({
      ...point,
      method: 'human_semantic',
      provenance,
    })),
    sources: [],
    derived: computeDerivedQuestionData(input.prompt, CREATED_AT),
    quality: {
      status: 'valid',
      issues: [],
      lastCheckedAt: CREATED_AT,
      qualityProfileVersion: QUALITY_PROFILE_VERSION,
    },
    metadata: {
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      status: 'active',
    },
  };
}

export const seedQuestions: readonly QuestionRevision[] = [
  makeSeedQuestion({
    questionId: 'sample-001',
    prompt: '日本で最も高い山は何でしょう？',
    primaryAnswer: '富士山',
    acceptedAnswers: ['ふじさん'],
    genre: '地理',
    questionType: 'short-fact',
    difficulty: 1,
    tags: ['日本', '地理'],
    determiningPoints: [
      { id: 'advanced', requiredPrefixGraphemes: 6 },
      { id: 'ideal', requiredPrefixGraphemes: 8 },
    ],
  }),
  makeSeedQuestion({
    questionId: 'sample-002',
    prompt: '元素記号Auで表される元素は何でしょう？',
    primaryAnswer: '金',
    acceptedAnswers: ['ゴールド'],
    rejectedAnswers: ['銀'],
    genre: '科学',
    questionType: 'definition',
    difficulty: 1,
    tags: ['化学'],
    determiningPoints: [{ id: 'ideal', requiredPrefixGraphemes: 7 }],
  }),
  makeSeedQuestion({
    questionId: 'sample-003',
    prompt: '『吾輩は猫である』を書いた作家は誰でしょう？',
    primaryAnswer: '夏目漱石',
    acceptedAnswers: ['漱石'],
    genre: '文学',
    questionType: 'work-author',
    difficulty: 1,
    tags: ['文学', '日本'],
    determiningPoints: [{ id: 'ideal', requiredPrefixGraphemes: 9 }],
  }),
];
