import { describe, expect, it } from 'vitest';
import { computeDerivedQuestionData, sha256Hex } from '../../src/data/questionIntegrity';

describe('Question derived integrity', () => {
  it('matches the standard SHA-256 abc test vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('uses the SHA-256 digest in canonical derived data', () => {
    const derived = computeDerivedQuestionData('abc', '2026-09-13T00:00:00.000Z');
    expect(derived.exactTextHash).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(derived.graphemeCount).toBe(3);
    expect(derived.duplicateDetectionKey).toBe('abc');
  });
});
