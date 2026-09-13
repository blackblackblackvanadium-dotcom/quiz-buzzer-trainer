export function splitGraphemes(text: string, locale = 'ja'): string[] {
  const SegmenterCtor = Intl.Segmenter;
  const segmenter = new SegmenterCtor(locale, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), (item) => item.segment);
}

export function visibleText(graphemes: readonly string[], count: number): string {
  return graphemes.slice(0, Math.max(0, Math.min(count, graphemes.length))).join('');
}
