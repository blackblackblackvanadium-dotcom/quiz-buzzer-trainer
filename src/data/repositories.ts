import type { Attempt, QuestionRevision, QuizMode, QuizSession, StudyState } from '../domain/types';
import { db, toQuestionRecord, type QbtDatabase, type QuestionRecord } from './db';

export class QuestionRepository {
  constructor(private readonly database: QbtDatabase = db) {}

  async list(): Promise<QuestionRevision[]> {
    const records = await this.database.questions.toArray();
    return records.map(({ key: _key, ...question }: QuestionRecord) => question);
  }

  async putMany(questions: readonly QuestionRevision[]): Promise<void> {
    await this.database.questions.bulkPut(questions.map(toQuestionRecord));
  }

  async count(): Promise<number> {
    return this.database.questions.count();
  }
}

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

  async end(sessionId: string, endedAt: string): Promise<void> {
    await this.database.sessions.update(sessionId, { endedAt });
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

export function modeNeedsStudyState(mode: QuizMode): boolean {
  return mode === 'review' || mode === 'study';
}
