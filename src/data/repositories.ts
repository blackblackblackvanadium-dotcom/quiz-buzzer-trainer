import type {
  Attempt,
  PersistedAttempt,
  QuestionRevision,
  QuizMode,
  QuizSession,
  StudyState,
} from '../domain/types';
import { questionKey } from '../domain/types';
import { db, toQuestionRecord, type QbtDatabase, type QuestionRecord } from './db';
import { assertDatabaseGeneration, withExclusiveAppWrite } from './concurrency';

function assertInputRevisionUniqueness(questions: readonly QuestionRevision[]): void {
  const keys = questions.map(questionKey);
  if (new Set(keys).size !== keys.length) throw new Error('Question batch contains duplicate question revisions');

  const numericRevisions = questions.map((question) => `${question.questionId}::revision:${question.revision}`);
  if (new Set(numericRevisions).size !== numericRevisions.length) {
    throw new Error('Question batch contains duplicate numeric revisions for one questionId');
  }
}

function assertPersistedAttemptContract(attempt: PersistedAttempt): void {
  const requiredCurrentFields = [
    'isCorrect',
    'startedAtEpochMs',
    'completedAtEpochMs',
    'totalGraphemeCount',
    'kimari',
  ] as const;
  for (const field of requiredCurrentFields) {
    if (!(field in attempt)) throw new Error(`PersistedAttempt.${field} is required`);
  }
  if (Date.parse(attempt.startedAt) !== attempt.startedAtEpochMs) {
    throw new Error('PersistedAttempt startedAt aliases are inconsistent');
  }
  if (Date.parse(attempt.completedAt) !== attempt.completedAtEpochMs) {
    throw new Error('PersistedAttempt completedAt aliases are inconsistent');
  }
}

function assertSessionPersistenceInvariant(session: QuizSession): void {
  const hasEndedAt = session.endedAt !== null;
  const hasEndedAtEpoch = session.endedAtEpochMs !== null;
  if (hasEndedAt !== hasEndedAtEpoch) throw new Error('Session endedAt aliases are inconsistent');
  if (session.endReason !== null && !hasEndedAt) {
    throw new Error('Session endReason requires endedAt');
  }
  if (Date.parse(session.startedAt) !== session.startedAtEpochMs) {
    throw new Error('Session startedAt aliases are inconsistent');
  }
  if (session.endedAt !== null && Date.parse(session.endedAt) !== session.endedAtEpochMs) {
    throw new Error('Session endedAt aliases are inconsistent');
  }
}

function assertExpectedGeneration(expectedGeneration: string | undefined): void {
  if (expectedGeneration !== undefined) assertDatabaseGeneration(expectedGeneration);
}

export class QuestionRepository {
  constructor(private readonly database: QbtDatabase = db) {}

  async list(): Promise<QuestionRevision[]> {
    const records = await this.database.questions.toArray();
    return records.map(({ key: _key, ...question }: QuestionRecord) => question);
  }

  async putMany(questions: readonly QuestionRevision[]): Promise<void> {
    assertInputRevisionUniqueness(questions);
    const keys = questions.map(questionKey);
    const records = questions.map(toQuestionRecord);
    const questionIds = [...new Set(questions.map((question) => question.questionId))];

    await withExclusiveAppWrite(async () => {
      await this.database.transaction('rw', this.database.questions, async () => {
        const existingByKey = await this.database.questions.bulkGet(keys);
        const collisionIndex = existingByKey.findIndex((record) => record !== undefined);
        if (collisionIndex >= 0) throw new Error(`Question revision is immutable and already exists: ${keys[collisionIndex]}`);

        const existingForLogicalQuestions = questionIds.length === 0
          ? []
          : await this.database.questions.where('questionId').anyOf(questionIds).toArray();
        const numericCollision = questions.find((incoming) =>
          existingForLogicalQuestions.some((existing) =>
            existing.questionId === incoming.questionId && existing.revision === incoming.revision,
          ),
        );
        if (numericCollision !== undefined) {
          throw new Error(`Question numeric revision already exists: ${numericCollision.questionId} revision ${numericCollision.revision}`);
        }
        await this.database.questions.bulkAdd(records);
      });
    });
  }

  async count(): Promise<number> {
    return this.database.questions.count();
  }
}

/** Current APP writes require PersistedAttempt; historical compatibility is read/migration only. */
export class AttemptRepository {
  constructor(private readonly database: QbtDatabase = db) {}

  async add(attempt: PersistedAttempt): Promise<void> {
    assertPersistedAttemptContract(attempt);
    await withExclusiveAppWrite(() => this.database.attempts.add(attempt).then(() => undefined));
  }

  async list(): Promise<Attempt[]> {
    return this.database.attempts.orderBy('completedAt').reverse().toArray();
  }
}

export class SessionRepository {
  constructor(private readonly database: QbtDatabase = db) {}

  async create(session: QuizSession, expectedGeneration?: string): Promise<void> {
    assertSessionPersistenceInvariant(session);
    await withExclusiveAppWrite(async () => {
      assertExpectedGeneration(expectedGeneration);
      await this.database.sessions.add(session);
    });
  }

  async put(session: QuizSession, expectedGeneration?: string): Promise<void> {
    assertSessionPersistenceInvariant(session);
    await withExclusiveAppWrite(async () => {
      assertExpectedGeneration(expectedGeneration);
      await this.database.sessions.put(session);
    });
  }

  async get(sessionId: string): Promise<QuizSession | undefined> {
    return this.database.sessions.get(sessionId);
  }
}

export class StudyStateRepository {
  constructor(private readonly database: QbtDatabase = db) {}

  async get(questionId: string, revisionId: string): Promise<StudyState | undefined> {
    return this.database.studyStates.get([questionId, revisionId]);
  }

  async put(state: StudyState): Promise<void> {
    await withExclusiveAppWrite(() => this.database.studyStates.put(state).then(() => undefined));
  }

  async list(): Promise<StudyState[]> {
    return this.database.studyStates.toArray();
  }

  async due(nowIso: string): Promise<StudyState[]> {
    return this.database.studyStates.where('dueAt').belowOrEqual(nowIso).toArray();
  }
}

export async function persistAttemptTransaction(
  attempt: PersistedAttempt,
  studyState: StudyState | null,
  database: QbtDatabase = db,
  expectedGeneration?: string,
): Promise<void> {
  assertPersistedAttemptContract(attempt);
  await withExclusiveAppWrite(async () => {
    assertExpectedGeneration(expectedGeneration);
    await database.transaction('rw', database.attempts, database.studyStates, async () => {
      await database.attempts.add(attempt);
      if (studyState !== null) await database.studyStates.put(studyState);
    });
  });
}

/** A resolved Attempt and its Session progress/end state commit together. */
export async function persistAttemptAndSessionTransaction(
  attempt: PersistedAttempt,
  session: QuizSession,
  studyState: StudyState | null = null,
  database: QbtDatabase = db,
  expectedGeneration?: string,
): Promise<void> {
  assertPersistedAttemptContract(attempt);
  assertSessionPersistenceInvariant(session);
  if (attempt.sessionId !== session.sessionId) throw new Error('Attempt and Session IDs do not match');

  await withExclusiveAppWrite(async () => {
    assertExpectedGeneration(expectedGeneration);
    await database.transaction('rw', database.attempts, database.sessions, database.studyStates, async () => {
      await database.attempts.add(attempt);
      await database.sessions.put(session);
      if (studyState !== null) await database.studyStates.put(studyState);
    });
  });
}

export function modeNeedsStudyState(mode: QuizMode): boolean {
  return mode === 'review' || mode === 'study';
}
