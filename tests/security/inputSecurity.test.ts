import { describe, expect, it } from 'vitest';
import { parseBackupJson } from '../../src/backup/backup';
import { parseQuestionDatasetJson } from '../../src/data/questionDataset';
import { MAX_UNTRUSTED_TEXT_CODE_UNITS } from '../../src/security/inputLimits';
import { makeQuestionV1 } from '../fixtures/questionV1';

function baseBackup(): Record<string, unknown> {
  return {
    format: 'qbt-backup',
    version: 1,
    exportedAt: '2026-09-14T00:00:00.000Z',
    appVersion: '0.1.0',
    dbSchemaVersion: 4,
    questionDataVersion: 'seed-v1',
    data: {
      questions: [],
      attempts: [],
      studyStates: [],
      sessions: [],
      settings: [],
    },
  };
}

function legacyAttemptWith(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attemptId: 'a1',
    questionId: 'q1',
    revisionId: 'r1',
    sessionId: 's1',
    mode: 'normal',
    outcome: 'correct',
    judgeKind: 'canonical',
    submittedAnswer: 'Answer',
    startedAt: '2026-09-14T00:00:00.000Z',
    completedAt: '2026-09-14T00:00:01.000Z',
    buzzIndex: 1,
    buzzRatio: 0.25,
    buzzTimeMs: 100,
    responseTimeMs: 200,
    visibleTextAtBuzz: 'a',
    ...extra,
  };
}

describe('P0 #7 untrusted input security', () => {
  it('rejects an oversized Backup before JSON parsing can process the payload', () => {
    const oversized = 'x'.repeat(MAX_UNTRUSTED_TEXT_CODE_UNITS + 1);
    expect(() => parseBackupJson(oversized)).toThrow('Backup JSON exceeds the Phase 1 input size limit');
  });

  it('rejects malformed JSON and malformed schema without persistence access', () => {
    expect(() => parseBackupJson('{not-json')).toThrow();

    const malformed = baseBackup();
    (malformed.data as Record<string, unknown>).attempts = [{ attemptId: 'missing-required-fields' }];
    expect(() => parseBackupJson(JSON.stringify(malformed))).toThrow();
  });

  it('rejects unknown fields nested in compatible Attempt records instead of silently stripping them', () => {
    const backup = baseBackup();
    (backup.data as Record<string, unknown>).attempts = [legacyAttemptWith({ injectedUnknown: '<script>alert(1)</script>' })];

    expect(() => parseBackupJson(JSON.stringify(backup))).toThrow('injectedUnknown is an unknown field');
  });

  it('rejects unknown fields nested in current Session records', () => {
    const backup = baseBackup();
    (backup.data as Record<string, unknown>).sessions = [{
      sessionId: 's1',
      mode: 'normal',
      startedAt: '2026-09-14T00:00:00.000Z',
      endedAt: null,
      startedAtEpochMs: Date.parse('2026-09-14T00:00:00.000Z'),
      endedAtEpochMs: null,
      endReason: null,
      targetQuestionCount: 1,
      consumedQuestionCount: 0,
      modeResult: null,
      unexpected: true,
    }];

    expect(() => parseBackupJson(JSON.stringify(backup))).toThrow('unexpected is an unknown field');
  });

  it('rejects oversized Question Dataset JSON before parsing', () => {
    const oversized = 'x'.repeat(MAX_UNTRUSTED_TEXT_CODE_UNITS + 1);
    expect(() => parseQuestionDatasetJson(oversized)).toThrow('Question Dataset JSON exceeds the Phase 1 input size limit');
  });

  it('rejects unknown Question Dataset fields under the strict canonical schema', () => {
    const dataset = {
      schemaVersion: 1,
      format: 'qbt-question-dataset',
      datasetId: 'security-test',
      datasetVersion: '1',
      exportedAt: '2026-09-14T00:00:00.000Z',
      generator: { name: 'test', version: '1' },
      questions: [{ ...makeQuestionV1(), maliciousUnknown: '<img src=x onerror=alert(1)>' }],
    };

    expect(() => parseQuestionDatasetJson(JSON.stringify(dataset))).toThrow('unknown field');
  });
});
