import { z } from 'zod';
import { CORE_FORMS } from '../companies';
import { isRealDate } from '../config/config';

/**
 * The only code that knows SEC's JSON shape (spec §9.3). It checks a raw file and
 * maps it to our types, or rejects the whole file with SecDataError. Pure functions.
 */

export interface SecFilingRow {
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  /** UTC, always YYYY-MM-DDTHH:mm:ssZ (SEC's milliseconds removed). */
  acceptanceDateTime: string;
  primaryDocument: string | null;
}

export interface ParsedSubmissions {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: (string | null)[];
  /** Core-form rows only. */
  rows: SecFilingRow[];
  /** Oldest filingDate over all rows, not only core rows. */
  oldestFilingDate: string | null;
  /** Overflow file names, in the order SEC lists them (newest first). */
  overflowFiles: string[];
}

export interface ParsedOverflow {
  rows: SecFilingRow[];
  oldestFilingDate: string | null;
}

export class SecDataError extends Error {
  override name = 'SecDataError';
}

const COLUMNS = [
  'accessionNumber',
  'form',
  'filingDate',
  'reportDate',
  'acceptanceDateTime',
  'primaryDocument',
] as const;

const columnsSchema = z.looseObject(
  Object.fromEntries(COLUMNS.map((c) => [c, z.array(z.string())])) as Record<
    (typeof COLUMNS)[number],
    z.ZodArray<z.ZodString>
  >,
);

const submissionsSchema = z.object({
  cik: z.string(),
  name: z.string(),
  tickers: z.array(z.string()),
  exchanges: z.array(z.string().nullable()),
  filings: z.object({
    recent: columnsSchema,
    files: z.array(z.looseObject({ name: z.string() })),
  }),
});

const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?Z$/;
const DOCUMENT = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const CORE = new Set(CORE_FORMS);

export function parseSubmissions(raw: unknown, expectedCik: string): ParsedSubmissions {
  const data = check(submissionsSchema, raw, 'submissions file');
  if (data.cik !== expectedCik) {
    throw new SecDataError(`submissions file: cik is ${data.cik}, expected ${expectedCik}`);
  }
  const fileName = new RegExp(`^CIK${expectedCik}-submissions-\\d{3}\\.json$`);
  for (const f of data.filings.files) {
    if (!fileName.test(f.name)) {
      throw new SecDataError(`submissions file: filings.files has an invalid name: ${f.name}`);
    }
  }
  const { rows, oldestFilingDate } = readColumns(data.filings.recent, 'filings.recent');
  return {
    cik: data.cik,
    name: data.name,
    tickers: data.tickers,
    exchanges: data.exchanges,
    rows,
    oldestFilingDate,
    overflowFiles: data.filings.files.map((f) => f.name),
  };
}

export function parseOverflow(raw: unknown): ParsedOverflow {
  return readColumns(check(columnsSchema, raw, 'overflow file'), 'overflow file');
}

function check<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SecDataError(`${what}: JSON is not an object`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new SecDataError(`${what}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  return result.data;
}

function readColumns(cols: z.infer<typeof columnsSchema>, where: string): ParsedOverflow {
  const lengths = new Set(
    Object.values(cols)
      .filter(Array.isArray)
      .map((a: unknown[]) => a.length),
  );
  if (lengths.size > 1) throw new SecDataError(`${where}: column arrays have different lengths`);

  const seen = new Set<string>();
  const rows: SecFilingRow[] = [];
  let oldest: string | null = null;
  for (let i = 0; i < cols.accessionNumber.length; i++) {
    const accession = cols.accessionNumber[i]!;
    if (seen.has(accession)) throw new SecDataError(`${where}: duplicate accession ${accession}`);
    seen.add(accession);
    const filingDate = cols.filingDate[i]!;
    if (isRealDate(filingDate) && (oldest === null || filingDate < oldest)) oldest = filingDate;
    if (!CORE.has(cols.form[i]!)) continue; // non-core rows are not checked (spec §9.3)
    rows.push(readCoreRow(cols, i, where));
  }
  return { rows, oldestFilingDate: oldest };
}

function readCoreRow(cols: z.infer<typeof columnsSchema>, i: number, where: string): SecFilingRow {
  const at = (c: (typeof COLUMNS)[number]) => cols[c][i]!;
  const fail = (column: string): never => {
    throw new SecDataError(
      `${where}: row ${at('accessionNumber')}: invalid ${column}: ${JSON.stringify(at(column as (typeof COLUMNS)[number]))}`,
    );
  };
  if (!ACCESSION.test(at('accessionNumber'))) fail('accessionNumber');
  if (!isRealDate(at('filingDate'))) fail('filingDate');
  const reportDate = at('reportDate');
  if (reportDate !== '' && !isRealDate(reportDate)) fail('reportDate');
  const acceptance = normaliseDateTime(at('acceptanceDateTime')) ?? fail('acceptanceDateTime');
  const doc = at('primaryDocument');
  if (doc !== '' && (!DOCUMENT.test(doc) || doc.split('/').includes('..'))) fail('primaryDocument');
  return {
    accessionNumber: at('accessionNumber'),
    form: at('form'),
    filingDate: at('filingDate'),
    reportDate: reportDate === '' ? null : reportDate,
    acceptanceDateTime: acceptance,
    primaryDocument: doc === '' ? null : doc,
  };
}

/** Returns YYYY-MM-DDTHH:mm:ssZ for a valid UTC date-time, or null. */
function normaliseDateTime(s: string): string | null {
  const m = DATE_TIME.exec(s);
  if (!m) return null;
  const [, date, hh, mm, ss] = m;
  if (!isRealDate(date!) || Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return null;
  return `${date}T${hh}:${mm}:${ss}Z`;
}
