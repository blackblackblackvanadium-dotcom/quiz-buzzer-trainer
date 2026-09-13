import {
  DERIVED_GENERATOR_VERSION,
  QUALITY_PROFILE_VERSION,
  type DerivedQuestionData,
  type QualityInfo,
  type QualityIssue,
  type QuestionRecordV1,
} from '../domain/types';

export const GRAPHEME_PROFILE = 'Intl.Segmenter:ja:grapheme';

const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const NORMALIZATION_SEPARATORS = /[\s\p{Z}\p{P}]+/gu;
const GENERATED_QUALITY_CODES = new Set([
  'duplicate_primary_accepted',
  'duplicate_accepted_answer',
  'duplicate_rejected_answer',
  'derived_grapheme_count_mismatch',
  'derived_grapheme_profile_mismatch',
  'derived_exact_text_hash_mismatch',
  'derived_duplicate_key_mismatch',
  'derived_generator_version_mismatch',
]);

export function assertValidUnicodeText(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`${label} contains a lone high surrogate`);
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) throw new Error(`${label} contains a lone low surrogate`);
  }
  if (FORBIDDEN_CONTROL.test(value)) throw new Error(`${label} contains a forbidden control character`);
}

export function normalizeDuplicateKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').trim().replace(NORMALIZATION_SEPARATORS, '');
}

export function countGraphemes(text: string): number {
  return Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)).length;
}

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** Small synchronous SHA-256 implementation used by DATA-derived fields in browser and tests. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = BigInt(bytes.length) * 8n;
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      words[index] = (
        (padded[base]! << 24)
        | (padded[base + 1]! << 16)
        | (padded[base + 2]! << 8)
        | padded[base + 3]!
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const w15 = words[index - 15]!;
      const w2 = words[index - 2]!;
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }

    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + choose + k[index]! + words[index]!) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  return h.map((value) => value.toString(16).padStart(8, '0')).join('');
}

export function computeDerivedQuestionData(prompt: string, computedAt: string): DerivedQuestionData {
  return {
    graphemeCount: countGraphemes(prompt),
    graphemeProfile: GRAPHEME_PROFILE,
    exactTextHash: `sha256:${sha256Hex(prompt)}`,
    duplicateDetectionKey: normalizeDuplicateKey(prompt),
    computedAt,
    generatorVersion: DERIVED_GENERATOR_VERSION,
  };
}

function duplicateWarnings(question: QuestionRecordV1): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const primary = normalizeDuplicateKey(question.answers.primaryAnswer.text);
  const acceptedSeen = new Set<string>();
  for (const answer of question.answers.acceptedAnswers) {
    const normalized = normalizeDuplicateKey(answer.text);
    if (normalized === primary) {
      issues.push({
        code: 'duplicate_primary_accepted',
        severity: 'warning',
        message: 'Accepted answer duplicates the primary answer after normalization.',
        field: 'answers.acceptedAnswers',
      });
    } else if (acceptedSeen.has(normalized)) {
      issues.push({
        code: 'duplicate_accepted_answer',
        severity: 'warning',
        message: 'Accepted answers contain a duplicate after normalization.',
        field: 'answers.acceptedAnswers',
      });
    }
    acceptedSeen.add(normalized);
  }

  const rejectedSeen = new Set<string>();
  for (const answer of question.answers.rejectedAnswers) {
    const normalized = normalizeDuplicateKey(answer.text);
    if (rejectedSeen.has(normalized)) {
      issues.push({
        code: 'duplicate_rejected_answer',
        severity: 'warning',
        message: 'Rejected answers contain a duplicate after normalization.',
        field: 'answers.rejectedAnswers',
      });
    }
    rejectedSeen.add(normalized);
  }
  return issues;
}

function derivedWarnings(supplied: DerivedQuestionData, computed: DerivedQuestionData): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const compare = (
    field: keyof Pick<DerivedQuestionData, 'graphemeCount' | 'graphemeProfile' | 'exactTextHash' | 'duplicateDetectionKey' | 'generatorVersion'>,
    code: string,
  ) => {
    if (supplied[field] !== computed[field]) {
      issues.push({
        code,
        severity: 'warning',
        message: `Imported derived.${field} was recomputed from the canonical question text.`,
        field: `derived.${field}`,
      });
    }
  };
  compare('graphemeCount', 'derived_grapheme_count_mismatch');
  compare('graphemeProfile', 'derived_grapheme_profile_mismatch');
  compare('exactTextHash', 'derived_exact_text_hash_mismatch');
  compare('duplicateDetectionKey', 'derived_duplicate_key_mismatch');
  compare('generatorVersion', 'derived_generator_version_mismatch');
  return issues;
}

export function buildPreparedQuality(
  question: QuestionRecordV1,
  computed: DerivedQuestionData,
  checkedAt: string,
): QualityInfo {
  const retained = question.quality.issues.filter((issue) => !GENERATED_QUALITY_CODES.has(issue.code));
  const generated = [...duplicateWarnings(question), ...derivedWarnings(question.derived, computed)];
  const issues = [...retained, ...generated];
  const status: QualityInfo['status'] = issues.some((issue) => issue.severity === 'error')
    ? 'error'
    : issues.some((issue) => issue.severity === 'warning')
      ? 'warning'
      : 'valid';
  return {
    status,
    issues,
    lastCheckedAt: checkedAt,
    qualityProfileVersion: QUALITY_PROFILE_VERSION,
  };
}
