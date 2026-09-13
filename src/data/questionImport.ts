import {
  type QuestionDatasetV1,
  type QuestionImportIssue,
  type QuestionImportMode,
  type QuestionImportResult,
  questionKey,
} from '../domain/types';
import { db, toQuestionRecord, type QbtDatabase } from './db';
import { prepareQuestionDatasetV1 } from './validation';

function flattenIssues(dataset: QuestionDatasetV1): QuestionImportIssue[] {
  return dataset.questions.flatMap((question) =>
    question.quality.issues.map((issue) => ({
      questionId: question.questionId,
      revisionId: question.revisionId,
      issue,
    })),
  );
}

function assertNoNumericRevisionCollision(
  incoming: readonly QuestionDatasetV1['questions'][number][],
  existing: readonly { questionId: string; revisionId: string; revision: number }[],
): void {
  const collision = incoming.find((candidate) =>
    existing.some((stored) =>
      stored.questionId === candidate.questionId
      && stored.revision === candidate.revision
      && stored.revisionId !== candidate.revisionId,
    ),
  );
  if (collision !== undefined) {
    throw new Error(`Question numeric revision already exists: ${collision.questionId} revision ${collision.revision}`);
  }
}

/**
 * Full DATA import pipeline: strict parse -> derived recomputation -> quality evaluation -> atomic DB commit.
 * App Backup/Restore is intentionally not used here.
 */
export async function importQuestionDataset(
  datasetInput: unknown,
  mode: QuestionImportMode,
  database: QbtDatabase = db,
  checkedAt = new Date().toISOString(),
): Promise<QuestionImportResult> {
  const dataset = prepareQuestionDatasetV1(datasetInput, checkedAt);
  const records = dataset.questions.map(toQuestionRecord);
  const incomingKeys = new Set(dataset.questions.map(questionKey));
  const issues = flattenIssues(dataset);

  return database.transaction('rw', database.questions, database.attempts, async () => {
    const existing = await database.questions.toArray();
    const existingKeys = new Set(existing.map((record) => record.key));

    if (mode === 'insert_only') {
      const duplicateKey = dataset.questions.find((question) => existingKeys.has(questionKey(question)));
      if (duplicateKey !== undefined) {
        throw new Error(`Question revision is immutable and already exists: ${questionKey(duplicateKey)}`);
      }
      assertNoNumericRevisionCollision(dataset.questions, existing);
      await database.questions.bulkAdd(records);
      return { mode, inserted: records.length, skipped: 0, replaced: 0, issues };
    }

    if (mode === 'merge') {
      assertNoNumericRevisionCollision(dataset.questions, existing);
      const newQuestions = dataset.questions.filter((question) => !existingKeys.has(questionKey(question)));
      if (newQuestions.length > 0) await database.questions.bulkAdd(newQuestions.map(toQuestionRecord));
      return {
        mode,
        inserted: newQuestions.length,
        skipped: dataset.questions.length - newQuestions.length,
        replaced: 0,
        issues,
      };
    }

    if (mode === 'restore') {
      const attempts = await database.attempts.toArray();
      const orphanedAttempt = attempts.find((attempt) => !incomingKeys.has(`${attempt.questionId}::${attempt.revisionId}`));
      if (orphanedAttempt !== undefined) {
        throw new Error(
          `Restore would orphan Attempt ${orphanedAttempt.attemptId}: ${orphanedAttempt.questionId}::${orphanedAttempt.revisionId}`,
        );
      }
      const replaced = existing.length;
      await database.questions.clear();
      if (records.length > 0) await database.questions.bulkAdd(records);
      return { mode, inserted: records.length, skipped: 0, replaced, issues };
    }

    const exhaustive: never = mode;
    throw new Error(`Unsupported Question import mode: ${String(exhaustive)}`);
  });
}
