import { describe, expect, it } from 'vitest';
import { splitGraphemes } from '../../src/engine/grapheme';

describe('splitGraphemes', () => {
  it('keeps combining marks in one grapheme', () => {
    expect(splitGraphemes('は\u3099')).toEqual(['は\u3099']);
  });

  it('keeps emoji ZWJ sequence in one grapheme', () => {
    expect(splitGraphemes('👨‍👩‍👧‍👦A')).toEqual(['👨‍👩‍👧‍👦', 'A']);
  });
});
