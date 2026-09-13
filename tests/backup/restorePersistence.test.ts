import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudyState } from '../../src/domain/types';
import { createBackup, parseBackupJson, replaceRestore, serializeBackup } from '../../src/backup/backup';
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

function studyState(questionId = 'q', revisionId = 'r1'): StudyState {
  return {
    questionId,
    revisionId,
    dueAt: '2026-09-15T00:00:00.000Z',
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

async function seedSnapshot(database: QbtDatabase, idPrefix: string): Promise<void> {
  const question = makeQuestionV1({
    questionId: `${idPrefix}-q`,
    revisionId: 'r1',
    revision: 1,
  });
  const sessionId = `${idPrefix}-session`;
  const session = createSessionRecord({
    sessionId,
    mode: 'normal',
    startedAt: '2026-09-14T00:00:00.000Z',
    targetQuestionCount: 1,
  });
  const attempt = createAttempt({
    attemptId: `${idPrefix}-attempt`,
    question,
    sessionId,
    mode: 'normal',
    outcome: 'correct',
    judge: { kind: 'canonical', isCorrect: true, normalizedSubmitted: 'answer', matchedAnswer: 'Answer' },
    submittedAnswer: 'Answer',
    startedAt: '2026-09-14T00:00:01.000Z',
    completedAt: '2026-09-14T00:00:02.000Z',
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
  const ended = endSessionRecord(
    session,
    'completed',
    attempt.completedAt,
    { consumedQuestionCount: 1 },
  );
  const state = studyState(question.questionId, question.revisionId);

  await database.questions.add(toQuestionRecord(question));
  await database.attempts.add(attempt);
  await database.studyStates.add(state);
  await database.sessions.add(ended);
  await database.settings.add({ key: `${idPrefix}-setting`, value: { enabled: true } });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe('P0 #6 Replace Restore', () => {
  it('round-trips the complete validated snapshot including all PersistedAttempt fields', async () => {
    const source = createDatabase('qbt-p0-6-backup-source');
    const target = createDatabase('qbt-p0-6-backup-target');
    await seedSnapshot(source, 'source');
    await seedSnapshot(target, 'old');

    const parsed = parseBackupJson(serializeBackup(await createBackup(source)));
    await replaceRestore(parsed, target);
    const restored = await createBackup(target);

    expect(restored.data).toEqual(parsed.data);
    expect(restored.data.attempts[0]).toEqual(parsed.data.attempts[0]);
    expect(await target.questions.get('old-q::r1')).toBeUndefined();
    expect(await target.attempts.get('old-attempt')).toBeUndefined();
    expect(await target.sessions.get('old-session')).toBeUndefined();
  });

  it('validates the entire backup before mutation and preserves the existing DB on malformed input', async () => {
    const source = createDatabase('qbt-p0-6-invalid-source');
    const target = createDatabase('qbt-p0-6-invalid-target');
    await seedSnapshot(source, 'source');
    await seedSnapshot(target, 'existing');
    const before = (await createBackup(target)).data;

    const invalid = JSON.parse(serializeBackup(await createBackup(source))) as {
      data: { attempts: Array<Record<string, unknown>> };
    };
    delete invalid.data.attempts[0]?.attemptId;

    await expect(replaceRestore(invalid, target)).rejects.toThrow();
    expect((await createBackup(target)).data).toEqual(before);
  });

  it('rejects duplicate restore keys before mutation and preserves the existing DB', async () => {
    const source = createDatabase('qbt-p0-6-duplicate-source');
    const target = createDatabase('qbt-p0-6-duplicate-target');
    await seedSnapshot(source, 'source');
    await seedSnapshot(target, 'existing');
    const before = (await createBackup(target)).data;

    const duplicate = JSON.parse(serializeBackup(await createBackup(source))) as {
      data: { settings: Array<{ key: string; value: unknown }> };
    };
    duplicate.data.settings.push({ ...duplicate.data.settings[0]! });

    await expect(replaceRestore(duplicate, target)).rejects.toThrow('Backup settings contains duplicate keys');
    expect((await createBackup(target)).data).toEqual(before);
  });

  it('rolls back clears and partial writes when restore is interrupted inside the transaction', async () => {
    const source = createDatabase('qbt-p0-6-rollback-source');
    const target = createDatabase('qbt-p0-6-rollback-target');
    await seedSnapshot(source, 'source');
    await seedSnapshot(target, 'existing');
    const before = (await createBackup(target)).data;
    const incoming = parseBackupJson(serializeBackup(await createBackup(source)));

    vi.spyOn(target.settings, 'bulkAdd').mockImplementationOnce(() => {
      throw new Error('injected restore interruption');
    });

    await expect(replaceRestore(incoming, target)).rejects.toThrow('injected restore interruption');
    expect((await createBackup(target)).data).toEqual(before);
  });
});
