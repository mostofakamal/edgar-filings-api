import { parseOverflow, parseSubmissions, SecDataError } from '../../src/sec/sec-adapter';
import { col, overflowFixture, recentOf, setCell, submissionsFixture } from '../support/fixtures';

const AAPL = '0000320193';
const GS = '0000886982';
const Q3_2024 = '0000320193-24-000081';

function expectReject(fn: () => unknown, text: string) {
  expect(fn).toThrow(SecDataError);
  expect(fn).toThrow(text);
}

describe('parseSubmissions', () => {
  it('reads company fields and turns parallel arrays into rows', () => {
    const p = parseSubmissions(submissionsFixture('CIK0000320193.json'), AAPL);
    expect(p).toMatchObject({
      cik: AAPL,
      name: 'Apple Inc.',
      tickers: ['AAPL'],
      exchanges: ['Nasdaq'],
    });
    expect(p.rows).toContainEqual({
      accessionNumber: '0000320193-24-000081',
      form: '10-Q',
      filingDate: '2024-08-02',
      reportDate: '2024-06-29',
      acceptanceDateTime: '2024-08-01T22:03:34Z',
      primaryDocument: 'aapl-20240629.htm',
    });
  });

  it('keeps only core forms but computes oldestFilingDate over all rows', () => {
    const p = parseSubmissions(submissionsFixture('CIK0000320193.json'), AAPL);
    expect(p.rows.map((r) => r.accessionNumber)).toEqual([
      '0000320193-26-000026',
      '0001140361-26-035325',
      '0000320193-26-000020',
      '0000320193-24-000081',
    ]);
    expect(p.oldestFilingDate).toBe('2015-10-07'); // a Form 4, not a core row
  });

  it('turns "" into null for reportDate and primaryDocument', () => {
    const raw = submissionsFixture('CIK0000320193.json');
    setCell(recentOf(raw), Q3_2024, 'reportDate', '');
    setCell(recentOf(raw), Q3_2024, 'primaryDocument', '');
    const row = parseSubmissions(raw, AAPL).rows.find(
      (r) => r.accessionNumber === '0000320193-24-000081',
    );
    expect(row).toMatchObject({ reportDate: null, primaryDocument: null });
  });

  it('strips milliseconds from acceptanceDateTime', () => {
    const raw = submissionsFixture('CIK0000320193.json');
    expect(col(recentOf(raw), 'acceptanceDateTime')).toContain('2024-08-01T22:03:34.000Z');
    const rows = parseSubmissions(raw, AAPL).rows;
    expect(
      rows.every((r) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(r.acceptanceDateTime)),
    ).toBe(true);
  });

  it('accepts acceptanceDateTime without milliseconds', () => {
    const raw = submissionsFixture('CIK0000320193.json');
    setCell(recentOf(raw), Q3_2024, 'acceptanceDateTime', '2024-08-01T22:03:34Z');
    expect(parseSubmissions(raw, AAPL).rows).toContainEqual(
      expect.objectContaining({ acceptanceDateTime: '2024-08-01T22:03:34Z' }),
    );
  });

  it('lists overflow files in the order SEC gives them', () => {
    const p = parseSubmissions(submissionsFixture('CIK0000886982.json'), GS);
    expect(p.overflowFiles).toEqual([
      'CIK0000886982-submissions-001.json',
      'CIK0000886982-submissions-022.json',
    ]);
  });

  it('returns oldestFilingDate null when there are no rows', () => {
    const raw = submissionsFixture('CIK0001018724.json');
    const cols = recentOf(raw);
    for (const k of Object.keys(cols)) cols[k] = [];
    const p = parseSubmissions(raw, '0001018724');
    expect(p.rows).toEqual([]);
    expect(p.oldestFilingDate).toBeNull();
  });

  describe('rejects the whole file', () => {
    it('when the JSON is not an object', () => {
      expectReject(() => parseSubmissions([], AAPL), 'not an object');
      expectReject(() => parseSubmissions(null, AAPL), 'not an object');
    });

    it('when filings.recent is missing', () => {
      const raw = submissionsFixture('CIK0000320193.json');
      delete raw.filings.recent;
      expectReject(() => parseSubmissions(raw, AAPL), 'filings.recent');
    });

    it('when a column is missing', () => {
      const raw = submissionsFixture('CIK0000320193.json');
      delete recentOf(raw).acceptanceDateTime;
      expectReject(() => parseSubmissions(raw, AAPL), 'acceptanceDateTime');
    });

    it('when column arrays have different lengths', () => {
      const raw = submissionsFixture('CIK0000320193.json');
      col(recentOf(raw), 'reportDate').pop();
      expectReject(() => parseSubmissions(raw, AAPL), 'different lengths');
    });

    it('when the cik is not the one we asked for', () => {
      expectReject(() => parseSubmissions(submissionsFixture('CIK0000320193.json'), GS), 'cik');
    });

    it.each([
      '../x.json',
      'CIK0000000001-submissions-001.json',
      'https://evil/CIK0000886982-submissions-001.json',
    ])('when a files[] name is %p', (name) => {
      const raw = submissionsFixture('CIK0000886982.json');
      raw.filings.files[0]!.name = name;
      expectReject(() => parseSubmissions(raw, GS), 'files');
    });

    it('when an accession number appears twice', () => {
      const raw = submissionsFixture('CIK0000320193.json');
      setCell(recentOf(raw), '0001209191-15-074803', 'accessionNumber', Q3_2024);
      expectReject(() => parseSubmissions(raw, AAPL), 'duplicate accession');
    });

    it.each([
      ['accessionNumber', '0000320193-24-81'],
      ['filingDate', '2024-02-30'],
      ['reportDate', '2024-6-29'],
      ['acceptanceDateTime', '2024-08-01 22:03:34'],
      ['acceptanceDateTime', '2024-08-01T25:03:34.000Z'],
      ['primaryDocument', '../a.htm'],
      ['primaryDocument', '/a.htm'],
      ['primaryDocument', 'a b.htm'],
    ])('when a core row has a bad %s (%p)', (column, value) => {
      const raw = submissionsFixture('CIK0000320193.json');
      setCell(recentOf(raw), Q3_2024, column, value);
      expectReject(() => parseSubmissions(raw, AAPL), column);
    });
  });

  it('skips odd values on non-core rows', () => {
    const raw = submissionsFixture('CIK0000320193.json');
    const form4 = '0001140361-26-044952';
    setCell(recentOf(raw), form4, 'reportDate', 'not a date');
    setCell(recentOf(raw), form4, 'primaryDocument', '../x.xml');
    expect(() => parseSubmissions(raw, AAPL)).not.toThrow();
  });
});

describe('parseOverflow', () => {
  it('reads rows and oldestFilingDate from an overflow file', () => {
    const p = parseOverflow(overflowFixture('CIK0000886982-submissions-022.json'));
    expect(p.rows.map((r) => r.form)).toEqual(['8-K', '8-K']);
    expect(p.oldestFilingDate).toBe('2020-12-28');
  });

  it('rejects an overflow file with different column lengths', () => {
    const raw = overflowFixture('CIK0000886982-submissions-001.json');
    col(raw, 'form').pop();
    expectReject(() => parseOverflow(raw), 'different lengths');
  });

  it('rejects an overflow file that is not an object', () => {
    expectReject(() => parseOverflow('x'), 'not an object');
  });
});
