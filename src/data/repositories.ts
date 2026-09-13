import type { Attempt, QuestionRevision, QuizMode, QuizSession, StudyState } from '../domain/types';
import { questionKey } from '../domain/types';
import { db, toQuestionRecord, type QbtDatabase, type QuestionRecord } from './db';

function assertInputRevisionUniqueness(questions: readonly QuestionRevision[]): void {
  const keys = questions.map(questionKey);
  if (new Set(keys).size !== keys.length) throw new Error('Question batch contains duplicate question revisions');

  const numericRevisions = questions.map((question) => `${question.questionId}::revision:${question.revision}`);
  if (new Set(numericRevisions).size !== numericRevisions.length) {
    throw new Error('Question batch contains duplicate numeric revisions for one questionId');
  }
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
  }

  async count(): Promise<number> {
    return this.database.questions.count();
  }
}

/** Read/write boundary remains legacy-compatible so DB migration/restore can preserve old history. */
export class AttemptRepository {
  constructor(private readonly database: QbtDatabase = db) {}

  async add(attempt: Attempt): Promise<void> {
    await this.database.attempts.add(attempt);
  }

  async list(): Promise<Attempt[]> {
    return this.database.attempts.orderBy('completedAt').reverse().toArray();
  }
}

export class SessionRepository {
  constructor(private readonly database: QbtDatabase = db) {}

  async create(session: QuizSession): Promise<void> {
    await this.database.sessions.add(session);
  }

  async put(session: QuizSession): Promise<void> {
    await this.database.sessions.put(session);
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
    await this.database.studyStates.put(state);
  }

  async list(): Promise<StudyState[]> {
    return this.database.studyStates.toArray();
  }

  async due(nowIso: string): Promise<StudyState[]> {
    return this.database.studyStates.where('dueAt').belowOrEqual(nowIso).toArray();
  }
}

export async function persistAttemptTransaction(
  attempt: Attempt,
  studyState: StudyState | null,
  database: QbtDatabase = db,
): Promise<void> {
  await database.transaction('rw', database.attempts, database.studyStates, async () => {
    await database.attempts.add(attempt);
    if (studyState !== null) await database.studyStates.put(studyState);
  });
}

/** P0 #4: a resolved Attempt and its Session progress/end state commit together. */
export async function persistAttemptAndSessionTransaction(
  attempt: Attempt,
  session: QuizSession,
  studyState: StudyState | null = null,
  database: QbtDatabase = db,
): Promise<void> {
  await database.transaction('rw', database.attempts, database.sessions, database.studyStates, async () => {
    await database.attempts.add(attempt);
    await database.sessions.put(session);
    if (studyState !== null) await database.studyStates.put(studyState);
  });
}

export function modeNeedsStudyState(mode: QuizMode): boolean {
  return mode === 'review' || mode === 'study';
}
