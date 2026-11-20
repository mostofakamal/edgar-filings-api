import { compareFilings, toFiling, type Filing } from '../../src/filings/filing';
import type { SecFilingRow } from '../../src/sec/sec-adapter';

const BASE = 'https://www.sec.gov/Archives/edgar/data';
const ROW: SecFilingRow = {
  accessionNumber: '0000320193-24-000081',
  form: '10-Q',
  filingDate: '2024-08-02',
  reportDate: '2024-06-29',
  acceptanceDateTime: '2024-08-01T22:03:34Z',
  primaryDocument: 'aapl-20240629.htm',
};

describe('toFiling', () => {
  it('builds the spec §7.3 filing, with primaryDocumentUrl without CIK zeros and accession dashes', () => {
    expect(toFiling(ROW, 'AAPL', '0000320193', BASE)).toEqual({
      accessionNumber: '0000320193-24-000081',
      ticker: 'AAPL',
      cik: '0000320193',
      form: '10-Q',
      filingDate: '2024-08-02',
      reportDate: '2024-06-29',
      acceptanceDateTime: '2024-08-01T22:03:34Z',
      primaryDocumentUrl:
        'https://www.sec.gov/Archives/edgar/data/320193/000032019324000081/aapl-20240629.htm',
    });
  });

  it('keeps a folder in primaryDocument', () => {
    const f = toFiling(
      { ...ROW, primaryDocument: 'xslF345X06/form4.xml' },
      'AAPL',
      '0000320193',
      BASE,
    );
    expect(f.primaryDocumentUrl).toBe(
      'https://www.sec.gov/Archives/edgar/data/320193/000032019324000081/xslF345X06/form4.xml',
    );
  });

  it('uses the configured archives base URL', () => {
    const f = toFiling(ROW, 'AAPL', '0000320193', 'http://mock.local/archive');
    expect(f.primaryDocumentUrl).toBe(
      'http://mock.local/archive/320193/000032019324000081/aapl-20240629.htm',
    );
  });

  it('gives a null url when primaryDocument is null', () => {
    expect(
      toFiling({ ...ROW, primaryDocument: null }, 'AAPL', '0000320193', BASE).primaryDocumentUrl,
    ).toBeNull();
  });
});

describe('compareFilings', () => {
  const f = (filingDate: string, acceptanceDateTime: string, accessionNumber: string): Filing => ({
    ...toFiling(ROW, 'AAPL', '0000320193', BASE),
    filingDate,
    acceptanceDateTime,
    accessionNumber,
  });

  it('orders by filingDate, then acceptanceDateTime, then accession, all descending', () => {
    const a = f('2024-08-02', '2024-08-01T22:03:34Z', '0000320193-24-000081');
    const b = f('2024-08-02', '2024-08-02T10:00:00Z', '0000320193-24-000082');
    const c = f('2024-08-02', '2024-08-02T10:00:00Z', '0000320193-24-000083');
    const d = f('2024-08-03', '2024-08-03T09:00:00Z', '0000320193-24-000084');
    expect([a, b, c, d].sort(compareFilings).map((x) => x.accessionNumber)).toEqual([
      '0000320193-24-000084',
      '0000320193-24-000083',
      '0000320193-24-000082',
      '0000320193-24-000081',
    ]);
  });

  it('returns 0 only for the same sort key', () => {
    const a = f('2024-08-02', '2024-08-01T22:03:34Z', '0000320193-24-000081');
    expect(compareFilings(a, { ...a })).toBe(0);
    expect(
      compareFilings(a, f('2024-08-01', '2024-08-01T22:03:34Z', '0000320193-24-000081')),
    ).toBeLessThan(0);
  });
});
