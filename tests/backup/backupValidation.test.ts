import { describe, expect, it } from 'vitest';
import { parsePortableBackup } from '../../src/data/validation';

describe('backup validation', () => {
  it('rejects unknown backup versions before DB access', () => {
    expect(() => parsePortableBackup({ format: 'qbt-backup', version: 99, data: {} })).toThrow();
  });
});
