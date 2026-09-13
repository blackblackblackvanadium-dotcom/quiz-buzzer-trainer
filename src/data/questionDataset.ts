import type { QuestionDatasetV1 } from '../domain/types';
import { parseQuestionDatasetV1 } from './validation';

export function parseQuestionDatasetJson(text: string): QuestionDatasetV1 {
  return parseQuestionDatasetV1(JSON.parse(text) as unknown);
}

export function serializeQuestionDataset(dataset: QuestionDatasetV1): string {
  return JSON.stringify(dataset, null, 2);
}
