import { parseSubmissions } from '../../src/sec/sec-adapter';
import { compareFilings, toFiling, type Filing } from '../../src/filings/filing';
import { submissionsFixture } from './fixtures';

/** AAPL's real core filings from the fixture, newest first (the spec §7.2/§7.3 examples). */
export function aaplFilings(): Filing[] {
  const p = parseSubmissions(submissionsFixture('CIK0000320193.json'), '0000320193');
  return p.rows
    .map((r) => toFiling(r, 'AAPL', '0000320193', 'https://www.sec.gov/Archives/edgar/data'))
    .sort(compareFilings);
}

export function makeFiling(over: Partial<Filing> & Pick<Filing, 'accessionNumber'>): Filing {
  return {
    ticker: 'AAPL',
    cik: '0000320193',
    form: '8-K',
    filingDate: '2026-01-01',
    reportDate: null,
    acceptanceDateTime: '2026-01-01T12:00:00Z',
    primaryDocumentUrl: null,
    ...over,
  };
}
