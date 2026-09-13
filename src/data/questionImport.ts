import {
  type QuestionDatasetV1,
  type QuestionImportIssue,
  type QuestionImportMode,
  type QuestionImportResult,
  type QuestionRecordV1,
  questionKey,
} from '../domain/types';
import { db, toQuestionRecord, type QbtDatabase, type QuestionRecord } from './db';
import { withExclusiveAppWrite } from './concurrency';
import {
  parseQuestionDatasetCsv,
  parseQuestionDatasetJson,
  type QuestionDatasetCsvMetadata,
} from './questionDataset';
import { prepareQuestionDatasetV1, prepareQuestionRecordV1 } from './validation';

function flattenIssues(dataset: QuestionDatasetV1): QuestionImportIssue[] {
  return dataset.questions.flatMap((question) =>
    question.quality.issues.map((issue) => ({
      questionId: question.questionId,
      revisionId: question.revisionId,
      issue,
    })),
  );
}

function assertNoBlockingQualityIssues(issues: readonly QuestionImportIssue[]): void {
  const blocking = issues.find((entry) => entry.issue.severity === 'error');
  if (blocking !== undefined) {
    throw new Error(
      `Question import blocked by quality error ${blocking.issue.code}: ${blocking.questionId}::${blocking.revisionId}`,
    );
  }
}

function assertNoNumericRevisionCollision(
  incoming: readonly QuestionRecordV1[],
  existing: readonly QuestionRecord[],
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

/** Fields below are revision-defining; derived/quality/metadata are operational and are recomputed or maintained separately. */
function revisionContent(question: QuestionRecordV1): unknown {
  return {
    schemaVersion: question.schemaVersion,
    questionId: question.questionId,
    revisionId: question.revisionId,
    revision: question.revision,
    prompt: question.prompt,
    answers: question.answers,
    classification: question.classification,
    determiningPoints: question.determiningPoints,
    sources: question.sources,
    extensions: question.extensions ?? null,
  };
}

function sameRevisionContent(left: QuestionRecordV1, right: QuestionRecordV1): boolean {
  return JSON.stringify(revisionContent(left)) === JSON.stringify(revisionContent(right));
}

function prepareStoredRecord(record: QuestionRecord, checkedAt: string): QuestionRecordV1 {
  const { key: _key, ...question } = record;
  return prepareQuestionRecordV1(question, checkedAt);
}

function assertExistingRevisionContentImmutable(
  incoming: readonly QuestionRecordV1[],
  existing: readonly QuestionRecord[],
  checkedAt: string,
): void {
  const existingByKey = new Map(existing.map((record) => [record.key, record]));
  for (const candidate of incoming) {
    const stored = existingByKey.get(questionKey(candidate));
    if (stored === undefined) continue;
    const preparedStored = prepareStoredRecord(stored, checkedAt);
    if (!sameRevisionContent(preparedStored, candidate)) {
      throw new Error(`REVISION_IMMUTABILITY_VIOLATION: ${questionKey(candidate)}`);
    }
  }
}

async function commitPreparedDataset(
  datasetInput: QuestionDatasetV1,
  mode: QuestionImportMode,
  database: QbtDatabase,
  checkedAt: string,
): Promise<QuestionImportResult> {
  const dataset = prepareQuestionDatasetV1(datasetInput, checkedAt);
  const records = dataset.questions.map(toQuestionRecord);
  const incomingKeys = new Set(dataset.questions.map(questionKey));
  const issues = flattenIssues(dataset);
  assertNoBlockingQualityIssues(issues);

  return withExclusiveAppWrite(() => database.transaction('rw', database.questions, database.attempts, async () => {
    const existing = await database.questions.toArray();
    const existingByKey = new Map(existing.map((record) => [record.key, record]));

    assertNoNumericRevisionCollision(dataset.questions, existing);

    if (mode === 'insert_only') {
      const duplicateKey = dataset.questions.find((question) => existingByKey.has(questionKey(question)));
      if (duplicateKey !== undefined) {
        throw new Error(`Question revision is immutable and already exists: ${questionKey(duplicateKey)}`);
      }
      await database.questions.bulkAdd(records);
      return { mode, inserted: records.length, skipped: 0, replaced: 0, issues };
    }

    if (mode === 'merge') {
      assertExistingRevisionContentImmutable(dataset.questions, existing, checkedAt);
      const newQuestions = dataset.questions.filter((question) => !existingByKey.has(questionKey(question)));
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
      assertExistingRevisionContentImmutable(dataset.questions, existing, checkedAt);
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
  }));
}

/** Canonical JSON import. All three DATA ImportModes are available. */
export async function importQuestionDatasetJson(
  text: string,
  mode: QuestionImportMode,
  database: QbtDatabase = db,
  checkedAt = new Date().toISOString(),
): Promise<QuestionImportResult> {
  return commitPreparedDataset(parseQuestionDatasetJson(text), mode, database, checkedAt);
}

/**
 * CSV is an auxiliary import-only format. It may insert or merge, but restore is
 * explicitly prohibited because canonical restore requires the JSON dataset envelope.
 */
export async function importQuestionDatasetCsv(
  text: string,
  metadata: QuestionDatasetCsvMetadata,
  mode: QuestionImportMode,
  database: QbtDatabase = db,
  checkedAt = new Date().toISOString(),
): Promise<QuestionImportResult> {
  if (mode === 'restore') throw new Error('CSV restore is prohibited; restore requires canonical Question Dataset JSON');
  return commitPreparedDataset(parseQuestionDatasetCsv(text, metadata), mode, database, checkedAt);
}
