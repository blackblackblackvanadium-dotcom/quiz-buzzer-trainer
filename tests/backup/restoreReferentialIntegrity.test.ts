import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudyState } from '../../src/domain/types';
import { createBackup, replaceRestore, serializeBackup } from '../../src/backup/backup';
import { getDatabaseGeneration } from '../../src/data/concurrency';
import { QbtDatabase, toQuestionRecord } from '../../src/data/db';
import { createAttempt } from '../../src/engine/attemptFactory';
import { createSessionRecord, endSessionRecord } from '../../src/engine/sessionFactory';
import { makeQuestionV1 } from '../fixtures/questionV1';

const databases: QbtDatabase[] = [];

function createDatabase(name: string): QbtDatabase {
  const database = new QbtDatabase(name);
  databases.push(database);
  return database;
}

function studyState(questionId: string, revisionId: string): StudyState {
  return {
    questionId,
    revisionId,
    dueAt: '2026-09-20T00:00:00.000Z',
    intervalDays: 1,
    easeFactor: 2.5,
    repetitions: 1,
    lapses: 0,
    bestBuzzIndex: 2,
    bestBuzzRatio: 0.5,
    bestResponseTimeMs: 300,
    correctCount: 1,
    attemptCount: 1,
    streak: 1,
  };
}

async function seedSnapshot(database: QbtDatabase, prefix: string): Promise<void> {
  const question = makeQuestionV1({
    questionId: `${prefix}-q`,
    revisionId: 'r1',
    revision: 1,
  });
  const session = createSessionRecord({
    sessionId: `${prefix}-session`,
    mode: 'normal',
    startedAt: '2026-09-19T00:00:00.000Z',
    targetQuestionCount: 1,
  });
  const attempt = createAttempt({
    attemptId: `${prefix}-attempt`,
    question,
    sessionId: session.sessionId,
    mode: 'normal',
    outcome: 'correct',
    judge: { kind: 'canonical', isCorrect: true, normalizedSubmitted: 'answer', matchedAnswer: 'Answer' },
    submittedAnswer: 'Answer',
    startedAt: '2026-09-19T00:00:01.000Z',
    completedAt: '2026-09-19T00:00:02.000Z',
    buzz: {
      buzzIndex: 2,
      totalGraphemeCount: 4,
      buzzRatio: 0.5,
      visibleText: 'ab',
      buzzTimeMs: 200,
      buzzAtMs: 200,
    },
    responseTimeMs: 300,
  });

  await database.questions.add(toQuestionRecord(question));
  await database.attempts.add(attempt);
  await database.studyStates.add(studyState(question.questionId, question.revisionId));
  await database.sessions.add(endSessionRecord(
    session,
    'completed',
    attempt.completedAt,
    { consumedQuestionCount: 1 },
  ));
  await database.settings.add({ key: `${prefix}-setting`, value: { enabled: true } });
}

function cloneBackup(value: unknown): {
  data: {
    attempts: Array<Record<string, unknown>>;
    studyStates: Array<Record<string, unknown>>;
  };
} {
  return JSON.parse(JSON.stringify(value)) as {
    data: {
      attempts: Array<Record<string, unknown>>;
      studyStates: Array<Record<string, unknown>>;
    };
  };
}

async function expectRejectedWithoutMutation(
  invalid: unknown,
  target: QbtDatabase,
  expectedMessage: string,
): Promise<void> {
  const before = (await createBackup(target)).data;
  const generationBefore = getDatabaseGeneration();
  const broadcasts: unknown[] = [];

  vi.stubGlobal('BroadcastChannel', class {
    constructor(_name: string) {}
    postMessage(value: unknown): void {
      broadcasts.push(value);
    }
    close(): void {}
  });

  await expect(replaceRestore(invalid, target)).rejects.toThrow(expectedMessage);

  expect((await createBackup(target)).data).toEqual(before);
  expect(getDatabaseGeneration()).toBe(generationBefore);
  expect(broadcasts).toEqual([]);

  await target.settings.put({ key: 'post-rejection-probe', value: true });
  expect(await target.settings.get('post-rejection-probe')).toEqual({
    key: 'post-rejection-probe',
    value: true,
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe('P0 #8 AC-09 restore referential integrity', () => {
  it('rejects dangling Attempt -> Question before mutation', async () => {
    const source = createDatabase('qbt-ac09-attempt-question-source');
    const target = createDatabase('qbt-ac09-attempt-question-target');
    await seedSnapshot(source, 'source');
    await seedSnapshot(target, 'existing');

    const invalid = cloneBackup(await createBackup(source));
    invalid.data.attempts[0]!.questionId = 'missing-question';

    await expectRejectedWithoutMutation(
      invalid,
      target,
      'references missing question missing-question::r1',
    );
  });

  it('rejects dangling Attempt -> Session before mutation', async () => {
    const source = createDatabase('qbt-ac09-attempt-session-source');
    const target = createDatabase('qbt-ac09-attempt-session-target');
    await seedSnapshot(source, 'source');
    await seedSnapshot(target, 'existing');

    const invalid = cloneBackup(await createBackup(source));
    invalid.data.attempts[0]!.sessionId = 'missing-session';

    await expectRejectedWithoutMutation(
      invalid,
      target,
      'references missing session missing-session',
    );
  });

  it('rejects dangling StudyState -> Question before mutation', async () => {
    const source = createDatabase('qbt-ac09-study-question-source');
    const target = createDatabase('qbt-ac09-study-question-target');
    await seedSnapshot(source, 'source');
    await seedSnapshot(target, 'existing');

    const invalid = cloneBackup(await createBackup(source));
    invalid.data.studyStates[0]!.questionId = 'missing-study-question';

    await expectRejectedWithoutMutation(
      invalid,
      target,
      'references missing question missing-study-question::r1',
    );
  });

  it('rejects a snapshot containing multiple dangling reference types without partial mutation', async () => {
    const source = createDatabase('qbt-ac09-multiple-source');
    const target = createDatabase('qbt-ac09-multiple-target');
    await seedSnapshot(source, 'source');
    await seedSnapshot(target, 'existing');

    const invalid = cloneBackup(await createBackup(source));
    invalid.data.attempts[0]!.questionId = 'missing-question';
    invalid.data.attempts[0]!.sessionId = 'missing-session';
    invalid.data.studyStates[0]!.questionId = 'missing-study-question';

    await expectRejectedWithoutMutation(
      invalid,
      target,
      'references missing question missing-question::r1',
    );
  });

  it('restores a valid snapshot and only then advances generation and broadcasts replacement', async () => {
    const source = createDatabase('qbt-ac09-valid-source');
    const target = createDatabase('qbt-ac09-valid-target');
    await seedSnapshot(source, 'source');
    await seedSnapshot(target, 'existing');

    const incoming = await createBackup(source);
    const generationBefore = getDatabaseGeneration();
    const broadcasts: unknown[] = [];

    vi.stubGlobal('BroadcastChannel', class {
      constructor(_name: string) {}
      postMessage(value: unknown): void {
        broadcasts.push(value);
      }
      close(): void {}
    });

    await replaceRestore(incoming, target);

    const restored = await createBackup(target);
    expect(restored.data).toEqual(incoming.data);
    expect(getDatabaseGeneration()).not.toBe(generationBefore);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({ type: 'database-replaced' });
  });
});
