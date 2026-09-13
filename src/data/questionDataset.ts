import {
  QUESTION_DATASET_FORMAT,
  QUESTION_DATASET_SCHEMA_VERSION,
  type QuestionDatasetV1,
} from '../domain/types';
import { parseQuestionDatasetV1 } from './validation';

export interface QuestionDatasetCsvMetadata {
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly exportedAt: string;
  readonly generator: {
    readonly name: string;
    readonly version: string;
  };
}

const CSV_HEADER = [
  'questionId',
  'revisionId',
  'revision',
  'prompt',
  'answersJson',
  'classificationJson',
  'determiningPointsJson',
  'sourcesJson',
  'derivedJson',
  'qualityJson',
  'metadataJson',
  'extensionsJson',
] as const;

/** Canonical Question Dataset interchange/export format. */
export function parseQuestionDatasetJson(text: string): QuestionDatasetV1 {
  return parseQuestionDatasetV1(JSON.parse(text) as unknown);
}

/** Canonical Question Dataset export. CSV is intentionally not an export format. */
export function serializeQuestionDataset(dataset: QuestionDatasetV1): string {
  return JSON.stringify(parseQuestionDatasetV1(dataset), null, 2);
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
    rows.push(row);
  }
  return rows.filter((candidate) => !(candidate.length === 1 && candidate[0] === ''));
}

function parseJsonCell(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

/**
 * Auxiliary import-only CSV adapter. It produces the same canonical Dataset v1
 * object but CSV itself is not a canonical export, backup, or restore format.
 */
export function parseQuestionDatasetCsv(text: string, metadata: QuestionDatasetCsvMetadata): QuestionDatasetV1 {
  const rows = parseCsvRows(text);
  if (rows.length === 0) throw new Error('CSV is empty');
  const header = rows[0]!;
  if (header.length !== CSV_HEADER.length || header.some((value, index) => value !== CSV_HEADER[index])) {
    throw new Error(`CSV header must exactly match: ${CSV_HEADER.join(',')}`);
  }

  const questions = rows.slice(1).map((row, rowIndex) => {
    if (row.length !== CSV_HEADER.length) throw new Error(`CSV row ${rowIndex + 2} has an invalid column count`);
    const revision = Number(row[2]);
    if (!Number.isInteger(revision) || revision < 1) throw new Error(`CSV row ${rowIndex + 2} revision must be a positive integer`);
    return {
      schemaVersion: 1,
      questionId: row[0],
      revisionId: row[1],
      revision,
      prompt: row[3],
      answers: parseJsonCell(row[4]!, `CSV row ${rowIndex + 2} answersJson`),
      classification: parseJsonCell(row[5]!, `CSV row ${rowIndex + 2} classificationJson`),
      determiningPoints: parseJsonCell(row[6]!, `CSV row ${rowIndex + 2} determiningPointsJson`),
      sources: parseJsonCell(row[7]!, `CSV row ${rowIndex + 2} sourcesJson`),
      derived: parseJsonCell(row[8]!, `CSV row ${rowIndex + 2} derivedJson`),
      quality: parseJsonCell(row[9]!, `CSV row ${rowIndex + 2} qualityJson`),
      metadata: parseJsonCell(row[10]!, `CSV row ${rowIndex + 2} metadataJson`),
      ...(row[11] === '' ? {} : { extensions: parseJsonCell(row[11]!, `CSV row ${rowIndex + 2} extensionsJson`) }),
    };
  });

  return parseQuestionDatasetV1({
    schemaVersion: QUESTION_DATASET_SCHEMA_VERSION,
    format: QUESTION_DATASET_FORMAT,
    datasetId: metadata.datasetId,
    datasetVersion: metadata.datasetVersion,
    exportedAt: metadata.exportedAt,
    generator: metadata.generator,
    questions,
  });
}
