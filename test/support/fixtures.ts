import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Column arrays as SEC sends them. Tests change them to make malformed data. */
export type Columns = Record<string, unknown[]>;

/** The parts of a submissions file the tests touch. */
export interface SubmissionsJson {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: (string | null)[];
  filings: { recent?: Columns; files: { name: string }[] };
}

/** Each call returns a fresh copy, so tests can change it freely. */
function read(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8')) as unknown;
}

export const submissionsFixture = (name: string) => read(name) as SubmissionsJson;
export const overflowFixture = (name: string) => read(name) as Columns;

export function recentOf(raw: SubmissionsJson): Columns {
  if (!raw.filings.recent) throw new Error('fixture has no filings.recent');
  return raw.filings.recent;
}

export function col(cols: Columns, name: string): unknown[] {
  const c = cols[name];
  if (!c) throw new Error(`fixture has no column ${name}`);
  return c;
}

/** Index of a row by accession number. */
export function rowIndex(cols: Columns, accession: string): number {
  const i = col(cols, 'accessionNumber').indexOf(accession);
  if (i < 0) throw new Error(`fixture has no ${accession}`);
  return i;
}

/** Sets one cell of a row identified by accession number. */
export function setCell(cols: Columns, accession: string, column: string, value: unknown): void {
  col(cols, column)[rowIndex(cols, accession)] = value;
}
