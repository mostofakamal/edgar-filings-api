import { findFiling, listFilings, parseListQuery, type ListQuery } from '../../src/filings/query';
import { Problem } from '../../src/common/problem';
import { InMemoryFilingsStore, type CompanyState } from '../../src/filings/filings.store';
import type { Filing } from '../../src/filings/filing';
import { aaplFilings, makeFiling } from '../support/filings';

const SINCE = '2021-01-01';

function problemOf(fn: () => unknown): Problem {
  try {
    fn();
  } catch (e) {
    if (e instanceof Problem) return e;
    throw e;
  }
  throw new Error('expected a Problem');
}

const parse = (q: Record<string, unknown>) => parseListQuery(q, SINCE);

describe('parseListQuery', () => {
  it('defaults limit to 20 and everything else to null', () => {
    expect(parse({})).toEqual({
      forms: null,
      filedFrom: null,
      filedTo: null,
      limit: 20,
      cursor: null,
    });
  });

  it('canonicalises forms: upper case, deduped, sorted', () => {
    expect(parse({ form: '10-q,10-K,10-Q,8-k/a' }).forms).toEqual(['10-K', '10-Q', '8-K/A']);
  });

  it('reads dates and limit', () => {
    expect(parse({ filedFrom: '2022-01-01', filedTo: '2022-12-31', limit: '100' })).toMatchObject({
      filedFrom: '2022-01-01',
      filedTo: '2022-12-31',
      limit: 100,
    });
  });

  it.each([
    [{ form: '10-K,' }, 'form', 'empty'],
    [{ form: '4' }, 'form', 'Supported forms: 10-K, 10-K/A, 10-Q, 10-Q/A, 8-K, 8-K/A.'],
    [{ forms: '10-K' }, 'forms', 'Unknown parameter'],
    [{ form: ['10-K', '10-Q'] }, 'form', 'more than once'],
    [{ form: { x: '1' } }, 'form', 'more than once'],
    [{ limit: '0' }, 'limit', 'from 1 to 100'],
    [{ limit: '101' }, 'limit', 'from 1 to 100'],
    [{ limit: '10.5' }, 'limit', 'from 1 to 100'],
    [{ limit: 'abc' }, 'limit', 'from 1 to 100'],
    [{ limit: '' }, 'limit', 'from 1 to 100'],
    [{ filedFrom: '2025-02-30' }, 'filedFrom', 'YYYY-MM-DD'],
    [{ filedFrom: '2025-13-01' }, 'filedFrom', 'YYYY-MM-DD'],
    [{ filedTo: '20250101' }, 'filedTo', 'YYYY-MM-DD'],
    [{ filedFrom: '2023-02-01', filedTo: '2023-01-01' }, 'filedFrom', 'after filedTo'],
  ])('rejects %p as invalid-parameter on %s', (q, parameter, text) => {
    const p = problemOf(() => parse(q));
    expect(p).toMatchObject({ status: 400, type: '/problems/invalid-parameter' });
    expect(p.errors).toContainEqual({ parameter, detail: expect.stringContaining(text) as string });
  });

  it('collects several problems in one error', () => {
    const p = problemOf(() => parse({ form: '4', limit: '0', x: '1' }));
    expect(p.errors!.map((e) => e.parameter).sort()).toEqual(['form', 'limit', 'x']);
  });

  it.each([{ filedFrom: '2019-01-01' }, { filedTo: '2020-12-31' }])(
    'rejects %p before FILINGS_SINCE as date-out-of-range',
    (q) => {
      expect(problemOf(() => parse(q))).toMatchObject({
        status: 400,
        type: '/problems/date-out-of-range',
      });
    },
  );

  it('reports format problems before date-out-of-range', () => {
    expect(problemOf(() => parse({ filedFrom: '2019-01-01', limit: '0' })).type).toBe(
      '/problems/invalid-parameter',
    );
  });

  it('decodes the cursor while parsing, so a broken cursor is a parameter problem', () => {
    expect(problemOf(() => parse({ cursor: 'xx' })).type).toBe('/problems/invalid-cursor');
  });
});

describe('listFilings', () => {
  const all = aaplFilings();
  const q = (over: Partial<Record<string, string>> = {}): ListQuery => parse(over);

  it('returns the spec §7.2 example page and cursor', () => {
    const page = listFilings(all, 'AAPL', q({ form: '10-K,10-Q', limit: '2' }));
    expect(page.data.map((f) => f.accessionNumber)).toEqual([
      '0000320193-26-000026',
      '0000320193-26-000020',
    ]);
    expect(page.nextCursor).toBe(
      'eyJ2IjoxLCJrIjpbIjIwMjYtMDctMzEiLCIyMDI2LTA3LTMxVDEwOjAxOjAyWiIsIjAwMDAzMjAxOTMtMjYtMDAwMDIwIl0sImYiOnsidCI6IkFBUEwiLCJmb3JtcyI6WyIxMC1LIiwiMTAtUSJdLCJmcm9tIjpudWxsLCJ0byI6bnVsbH19',
    );
  });

  it('orders newest first with ties broken by acceptanceDateTime then accession', () => {
    const fs = [
      makeFiling({
        accessionNumber: '0000000000-26-000001',
        filingDate: '2026-01-02',
        acceptanceDateTime: '2026-01-01T23:00:00Z',
      }),
      makeFiling({
        accessionNumber: '0000000000-26-000002',
        filingDate: '2026-01-02',
        acceptanceDateTime: '2026-01-02T09:00:00Z',
      }),
      makeFiling({
        accessionNumber: '0000000000-26-000003',
        filingDate: '2026-01-02',
        acceptanceDateTime: '2026-01-02T09:00:00Z',
      }),
    ];
    expect(listFilings(fs, 'AAPL', q()).data.map((f) => f.accessionNumber)).toEqual([
      '0000000000-26-000003',
      '0000000000-26-000002',
      '0000000000-26-000001',
    ]);
  });

  it('filters by forms and inclusive dates', () => {
    expect(listFilings(all, 'AAPL', q({ form: '8-K/A' })).data.map((f) => f.form)).toEqual([
      '8-K/A',
    ]);
    const ranged = listFilings(all, 'AAPL', q({ filedFrom: '2026-07-31', filedTo: '2026-09-01' }));
    expect(ranged.data.map((f) => f.filingDate)).toEqual(['2026-09-01', '2026-07-31']);
  });

  it('returns nextCursor null when no more rows, including when exactly limit rows remain', () => {
    expect(listFilings(all, 'AAPL', q({ limit: '4' })).nextCursor).toBeNull();
    expect(listFilings(all, 'AAPL', q({ limit: '3' })).nextCursor).not.toBeNull();
    expect(listFilings([], 'AAPL', q())).toEqual({ data: [], nextCursor: null });
  });

  it('continues after the cursor', () => {
    const first = listFilings(all, 'AAPL', q({ limit: '3' }));
    const second = listFilings(all, 'AAPL', q({ limit: '3', cursor: first.nextCursor! }));
    expect(second.data.map((f) => f.accessionNumber)).toEqual(['0000320193-24-000081']);
    expect(second.nextCursor).toBeNull();
  });

  it('accepts a cursor with forms in another order and a different limit', () => {
    const first = listFilings(all, 'AAPL', q({ form: '10-K,10-Q', limit: '1' }));
    const next = listFilings(
      all,
      'AAPL',
      q({ form: '10-q,10-K', limit: '5', cursor: first.nextCursor! }),
    );
    expect(next.data.map((f) => f.accessionNumber)).toEqual([
      '0000320193-26-000020',
      '0000320193-24-000081',
    ]);
  });

  it.each([{ form: '10-K' }, { filedFrom: '2022-01-01' }, {}])(
    'rejects a cursor reused with different filters (%p)',
    (other) => {
      const first = listFilings(all, 'AAPL', q({ form: '10-K,10-Q', limit: '1' }));
      expect(
        problemOf(() => listFilings(all, 'AAPL', q({ ...other, cursor: first.nextCursor! }))).type,
      ).toBe('/problems/invalid-cursor');
    },
  );

  it('rejects a cursor from another company', () => {
    const first = listFilings(all, 'AAPL', q({ limit: '1' }));
    expect(problemOf(() => listFilings(all, 'GS', q({ cursor: first.nextCursor! }))).type).toBe(
      '/problems/invalid-cursor',
    );
  });

  it('a filing added before the cursor position between pages causes no duplicate or skip', () => {
    const first = listFilings(all, 'AAPL', q({ limit: '2' }));
    const newer = makeFiling({ accessionNumber: '0000320193-26-000099', filingDate: '2026-11-19' });
    const second = listFilings(
      [newer, ...all],
      'AAPL',
      q({ limit: '2', cursor: first.nextCursor! }),
    );
    const seen = [...first.data, ...second.data].map((f) => f.accessionNumber);
    expect(seen).toEqual(all.map((f) => f.accessionNumber));
  });
});

describe('findFiling', () => {
  const loaded = (filings: Filing[]): CompanyState => ({
    ticker: 'AAPL',
    status: 'loaded',
    company: {
      ticker: 'AAPL',
      cik: '0000320193',
      name: 'Apple Inc.',
      exchange: 'Nasdaq',
      filingsAvailableFrom: SINCE,
    },
    filings,
    dataAsOf: '2026-11-20T16:30:00Z',
    lastError: null,
    nextFullLoadAt: null,
    failures: 0,
  });
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  function storeWith(allLoaded: boolean) {
    const store = new InMemoryFilingsStore(log);
    store.setCompany(loaded(aaplFilings()));
    if (allLoaded) {
      for (const t of ['AMZN', 'GOOGL', 'GS', 'META', 'NFLX'] as const)
        store.setCompany({ ...loaded([]), ticker: t });
    }
    return store.get();
  }

  it('returns the filing', () => {
    expect(findFiling(storeWith(false), '0000320193-24-000081', SINCE, 60).filingDate).toBe(
      '2024-08-02',
    );
  });

  it.each(['123', '000032019324000081', '0000320193-24-00008'])('rejects bad format %p', (a) => {
    const p = problemOf(() => findFiling(storeWith(true), a, SINCE, 60));
    expect(p).toMatchObject({ status: 400, type: '/problems/invalid-parameter' });
    expect(p.detail).toContain('0000320193-24-000081');
  });

  it('unknown accession while a company has no data → data-unavailable with Retry-After', () => {
    expect(
      problemOf(() => findFiling(storeWith(false), '0000320193-24-999999', SINCE, 60)),
    ).toMatchObject({
      status: 503,
      type: '/problems/data-unavailable',
      retryAfterSeconds: 60,
    });
  });

  it('unknown accession when all companies have data → filing-not-found naming FILINGS_SINCE', () => {
    const p = problemOf(() => findFiling(storeWith(true), '0000320193-24-999999', SINCE, 60));
    expect(p).toMatchObject({ status: 404, type: '/problems/filing-not-found' });
    expect(p.detail).toContain('2021-01-01');
  });
});
