import { afterAll, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { StudyState } from '../src/domain/types';
import { createBackup, parseBackupJson, replaceRestore, serializeBackup } from '../src/backup/backup';
import { getDatabaseGeneration } from '../src/data/concurrency';
import { QbtDatabase, toQuestionRecord } from '../src/data/db';
import { createAttempt } from '../src/engine/attemptFactory';
import { createSessionRecord, endSessionRecord } from '../src/engine/sessionFactory';
import { makeQuestionV1 } from '../tests/fixtures/questionV1';

const root = resolve(process.env.EVIDENCE_DIR ?? '../evidence', 'AC-09');
const databases: QbtDatabase[] = [];

function db(name: string): QbtDatabase {
  const value = new QbtDatabase(name);
  databases.push(value);
  return value;
}

function state(questionId: string, revisionId: string): StudyState {
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

async function seed(database: QbtDatabase, prefix: string): Promise<void> {
  const question = makeQuestionV1({ questionId: `${prefix}-q`, revisionId: 'r1', revision: 1 });
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
  await database.studyStates.add(state(question.questionId, question.revisionId));
  await database.sessions.add(endSessionRecord(session, 'completed', attempt.completedAt, { consumedQuestionCount: 1 }));
  await database.settings.add({ key: `${prefix}-setting`, value: { enabled: true } });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(resolve(root, path), JSON.stringify(value, null, 2) + '\n');
}

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(databases.map(async (database) => {
    database.close();
    await database.delete();
  }));
});

it('AC-09 corrupted backup rejection evidence matrix', async () => {
  await mkdir(root, { recursive: true });
  localStorage.clear();

  const source = db('qbt-ac09-evidence-source');
  await seed(source, 'source');
  const valid = await createBackup(source);
  await writeJson('valid-backup.json', valid);

  const results: Array<Record<string, unknown>> = [];

  const parseCases: Array<{ name: string; execute: () => void; fixture: unknown }> = [
    {
      name: 'invalid-json',
      fixture: '{not-json',
      execute: () => { parseBackupJson('{not-json'); },
    },
    {
      name: 'unsupported-format',
      fixture: { ...clone(valid), format: 'unsupported' },
      execute: () => { parseBackupJson(JSON.stringify({ ...clone(valid), format: 'unsupported' })); },
    },
    {
      name: 'unsupported-version',
      fixture: { ...clone(valid), version: 99 },
      execute: () => { parseBackupJson(JSON.stringify({ ...clone(valid), version: 99 })); },
    },
    {
      name: 'missing-field',
      fixture: (() => {
        const value = clone(valid) as unknown as { data: { attempts: Array<Record<string, unknown>> } };
        delete value.data.attempts[0]!.attemptId;
        return value;
      })(),
      execute: () => {
        const value = clone(valid) as unknown as { data: { attempts: Array<Record<string, unknown>> } };
        delete value.data.attempts[0]!.attemptId;
        parseBackupJson(JSON.stringify(value));
      },
    },
    {
      name: 'invalid-type',
      fixture: (() => {
        const value = clone(valid) as unknown as { data: Record<string, unknown> };
        value.data.attempts = 'not-an-array';
        return value;
      })(),
      execute: () => {
        const value = clone(valid) as unknown as { data: Record<string, unknown> };
        value.data.attempts = 'not-an-array';
        parseBackupJson(JSON.stringify(value));
      },
    },
    {
      name: 'unknown-field',
      fixture: (() => {
        const value = clone(valid) as unknown as { data: { attempts: Array<Record<string, unknown>> } };
        value.data.attempts[0]!.injectedUnknown = '<script>alert(1)</script>';
        return value;
      })(),
      execute: () => {
        const value = clone(valid) as unknown as { data: { attempts: Array<Record<string, unknown>> } };
        value.data.attempts[0]!.injectedUnknown = '<script>alert(1)</script>';
        parseBackupJson(JSON.stringify(value));
      },
    },
  ];

  for (const testCase of parseCases) {
    let rejected = false;
    let error: string | null = null;
    try {
      testCase.execute();
    } catch (caught) {
      rejected = true;
      error = caught instanceof Error ? caught.message : String(caught);
    }
    await writeJson(`fixtures/${testCase.name}.json`, testCase.fixture);
    results.push({ case: testCase.name, rejected, error, pass: rejected });
  }

  const restoreCases: Array<{
    name: string;
    mutate: (value: any) => void;
    expected: RegExp;
    requireWritableProbe?: boolean;
  }> = [
    {
      name: 'duplicate-key',
      mutate: (value) => { value.data.settings.push({ ...value.data.settings[0] }); },
      expected: /duplicate keys/u,
    },
    {
      name: 'dangling-attempt-question',
      mutate: (value) => { value.data.attempts[0].questionId = 'missing-question'; },
      expected: /references missing question missing-question::r1/u,
      requireWritableProbe: true,
    },
    {
      name: 'dangling-attempt-session',
      mutate: (value) => { value.data.attempts[0].sessionId = 'missing-session'; },
      expected: /references missing session missing-session/u,
      requireWritableProbe: true,
    },
    {
      name: 'dangling-study-question',
      mutate: (value) => { value.data.studyStates[0].questionId = 'missing-study-question'; },
      expected: /references missing question missing-study-question::r1/u,
      requireWritableProbe: true,
    },
    {
      name: 'multiple-dangling-references',
      mutate: (value) => {
        value.data.attempts[0].questionId = 'missing-question';
        value.data.attempts[0].sessionId = 'missing-session';
        value.data.studyStates[0].questionId = 'missing-study-question';
      },
      expected: /references missing question missing-question::r1/u,
      requireWritableProbe: true,
    },
  ];

  for (const testCase of restoreCases) {
    const target = db(`qbt-ac09-evidence-${testCase.name}`);
    await seed(target, 'existing');
    const before = await createBackup(target);
    const generationBefore = getDatabaseGeneration();
    const broadcasts: unknown[] = [];
    vi.stubGlobal('BroadcastChannel', class {
      constructor(_name: string) {}
      postMessage(value: unknown): void { broadcasts.push(value); }
      close(): void {}
    });

    const invalid = clone(valid) as any;
    testCase.mutate(invalid);
    await writeJson(`fixtures/${testCase.name}.json`, invalid);
    await writeJson(`snapshots/${testCase.name}-pre.json`, before);

    let rejected = false;
    let error: string | null = null;
    try {
      await replaceRestore(invalid, target);
    } catch (caught) {
      rejected = true;
      error = caught instanceof Error ? caught.message : String(caught);
    }

    const after = await createBackup(target);
    const unchanged = JSON.stringify(after.data) === JSON.stringify(before.data);
    const generationUnchanged = getDatabaseGeneration() === generationBefore;
    const broadcastSuppressed = broadcasts.length === 0;
    let readWriteUsable = true;
    if (testCase.requireWritableProbe) {
      try {
        await target.settings.put({ key: `probe-${testCase.name}`, value: true });
        readWriteUsable = (await target.settings.get(`probe-${testCase.name}`))?.value === true;
      } catch {
        readWriteUsable = false;
      }
    }

    await writeJson(`snapshots/${testCase.name}-post.json`, after);
    const messageMatches = error !== null && testCase.expected.test(error);
    results.push({
      case: testCase.name,
      rejected,
      error,
      messageMatches,
      dbUnchanged: unchanged,
      generationUnchanged,
      broadcastSuppressed,
      readWriteUsable,
      pass: rejected && messageMatches && unchanged && generationUnchanged && broadcastSuppressed && readWriteUsable,
    });
    vi.unstubAllGlobals();
  }

  const validTarget = db('qbt-ac09-evidence-valid-target');
  await seed(validTarget, 'existing-valid-target');
  const validPre = await createBackup(validTarget);
  await writeJson('snapshots/valid-restore-pre.json', validPre);
  const generationBeforeValid = getDatabaseGeneration();
  const validBroadcasts: unknown[] = [];
  vi.stubGlobal('BroadcastChannel', class {
    constructor(_name: string) {}
    postMessage(value: unknown): void { validBroadcasts.push(value); }
    close(): void {}
  });
  await replaceRestore(valid, validTarget);
  const validPost = await createBackup(validTarget);
  await writeJson('snapshots/valid-restore-post.json', validPost);
  const validPass =
    JSON.stringify(validPost.data) === JSON.stringify(valid.data)
    && getDatabaseGeneration() !== generationBeforeValid
    && validBroadcasts.length === 1;
  results.push({
    case: 'valid-backup-restore',
    restoredExactly: JSON.stringify(validPost.data) === JSON.stringify(valid.data),
    generationAdvanced: getDatabaseGeneration() !== generationBeforeValid,
    broadcasts: validBroadcasts.length,
    pass: validPass,
  });

  const pass = results.every((item) => item.pass === true);
  await writeJson('ac09-individual-results.json', results);
  await writeJson('ac09-final-report.json', {
    ac: 'AC-09',
    pass,
    targetCommit: process.env.TARGET_SHA ?? null,
    cases: results.length,
    failedCases: results.filter((item) => item.pass !== true).map((item) => item.case),
    p0Failed: pass ? 0 : 1,
    error: 0,
    skipped: 0,
    flaky: 0,
    knownFailure: 0,
    blocker: 0,
    critical: 0,
  });

  expect(pass).toBe(true);
});
