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

/** Newest first: filingDate, then acceptanceDateTime, then accessionNumber, all descending (spec §7.2). */
export function compareFilings(a: Filing, b: Filing): number {
  return (
    desc(a.filingDate, b.filingDate) ||
    desc(a.acceptanceDateTime, b.acceptanceDateTime) ||
    desc(a.accessionNumber, b.accessionNumber)
  );
}

function desc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}
