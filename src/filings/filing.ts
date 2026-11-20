import type { Ticker } from '../companies';
import type { SecFilingRow } from '../sec/sec-adapter';

/** A filing as the API returns it (spec §6). */
export interface Filing {
  accessionNumber: string;
  ticker: Ticker;
  cik: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  acceptanceDateTime: string;
  primaryDocumentUrl: string | null;
}

/** A company as the API returns it (spec §6). */
export interface Company {
  ticker: Ticker;
  cik: string;
  name: string;
  exchange: string | null;
  filingsAvailableFrom: string;
}

export function toFiling(
  row: SecFilingRow,
  ticker: Ticker,
  cik: string,
  archivesBaseUrl: string,
): Filing {
  const url =
    row.primaryDocument === null
      ? null
      : `${archivesBaseUrl}/${cik.replace(/^0+/, '')}/${row.accessionNumber.replace(/-/g, '')}/${row.primaryDocument}`;
  return {
    accessionNumber: row.accessionNumber,
    ticker,
    cik,
    form: row.form,
    filingDate: row.filingDate,
    reportDate: row.reportDate,
    acceptanceDateTime: row.acceptanceDateTime,
    primaryDocumentUrl: url,
  };
}

/** The sort key: [filingDate, acceptanceDateTime, accessionNumber]. */
export type SortKey = [string, string, string];

export function sortKeyOf(f: Filing): SortKey {
  return [f.filingDate, f.acceptanceDateTime, f.accessionNumber];
}

/** Newest first: filingDate, then acceptanceDateTime, then accessionNumber, all descending (spec §7.2). */
export function compareSortKeys(a: SortKey, b: SortKey): number {
  return desc(a[0], b[0]) || desc(a[1], b[1]) || desc(a[2], b[2]);
}

export function compareFilings(a: Filing, b: Filing): number {
  return compareSortKeys(sortKeyOf(a), sortKeyOf(b));
}

function desc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}
