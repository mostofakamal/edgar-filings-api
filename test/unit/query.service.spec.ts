import { FilingsQueryService } from '../../src/filings/query.service';
import { InMemoryFilingsStore, type CompanyState } from '../../src/filings/filings.store';
import { Problem } from '../../src/common/problem';
import { loadConfig } from '../../src/config/config';
import { aaplFilings } from '../support/filings';

const CFG = loadConfig(
  { SEC_USER_AGENT: 'Test Company@example.com' },
  new Date('2026-11-20T00:00:00Z'),
);
const AAPL: CompanyState = {
  ticker: 'AAPL',
  status: 'stale',
  company: {
    ticker: 'AAPL',
    cik: '0000320193',
    name: 'Apple Inc.',
    exchange: 'Nasdaq',
    filingsAvailableFrom: '2021-01-01',
  },
  filings: aaplFilings(),
  dataAsOf: '2026-11-20T16:30:00Z',
  lastError: 'SEC returned 503',
  nextFullLoadAt: null,
  failures: 0,
};

const NOW = Date.parse('2026-11-20T16:31:00Z');

function service(extra: CompanyState[] = []) {
  const store = new InMemoryFilingsStore({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  store.setCompany(AAPL);
  extra.forEach((s) => store.setCompany(s));
  return new FilingsQueryService(store, CFG, { now: () => NOW });
}

const failedGs = (secondsUntilRetry: number): CompanyState => ({
  ticker: 'GS',
  status: 'failed',
  company: null,
  filings: [],
  dataAsOf: null,
  lastError: 'fetch failed',
  nextFullLoadAt: NOW + secondsUntilRetry * 1000,
  failures: 2,
});

function problemOf(fn: () => unknown): Problem {
  try {
    fn();
  } catch (e) {
    if (e instanceof Problem) return e;
    throw e;
  }
  throw new Error('expected a Problem');
}

describe('FilingsQueryService', () => {
  it('getCompany is case-insensitive and returns the company with its dataAsOf', () => {
    expect(service().getCompany('aapl')).toEqual({
      company: AAPL.company,
      dataAsOf: '2026-11-20T16:30:00Z',
    });
  });

  it.each(['GOOG', 'AAPL.', ' AAPL', 'A'.repeat(200)])(
    'unknown ticker %p → company-not-found',
    (t) => {
      const p = problemOf(() => service().getCompany(t));
      expect(p).toMatchObject({ status: 404, type: '/problems/company-not-found' });
      expect(p.detail).toContain('Supported tickers: AAPL, AMZN, GOOGL, GS, META, NFLX.');
    },
  );

  it('a company with no data yet → data-unavailable with the refresh interval as Retry-After', () => {
    expect(problemOf(() => service().getCompany('GS'))).toMatchObject({
      status: 503,
      type: '/problems/data-unavailable',
      retryAfterSeconds: 60,
    });
  });

  it('Retry-After is the time until a failed company is tried again', () => {
    expect(problemOf(() => service([failedGs(600)]).getCompany('GS')).retryAfterSeconds).toBe(600);
  });

  it('Retry-After is never below the refresh interval', () => {
    expect(problemOf(() => service([failedGs(10)]).getCompany('GS')).retryAfterSeconds).toBe(60);
  });

  it('accession lookup while companies are missing uses the soonest next attempt', () => {
    const p = problemOf(() =>
      service([failedGs(900), { ...failedGs(600), ticker: 'META' }]).getFiling(
        '0000320193-24-999999',
      ),
    );
    // AMZN, GOOGL and NFLX were never tried: their next try is the next refresh (60 s).
    expect(p.retryAfterSeconds).toBe(60);
    const loaded = (t: 'AMZN' | 'GOOGL' | 'NFLX'): CompanyState => ({
      ...AAPL,
      ticker: t,
      status: 'loaded',
    });
    const q = problemOf(() =>
      service([
        failedGs(900),
        { ...failedGs(600), ticker: 'META' },
        loaded('AMZN'),
        loaded('GOOGL'),
        loaded('NFLX'),
      ]).getFiling('0000320193-24-999999'),
    );
    expect(q.retryAfterSeconds).toBe(600);
  });

  it('lists filings with limit and dataAsOf', () => {
    const r = service().listCompanyFilings('AAPL', { form: '10-K,10-Q', limit: '2' });
    expect(r.data).toHaveLength(2);
    expect(r).toMatchObject({ limit: 2, dataAsOf: '2026-11-20T16:30:00Z' });
    expect(r.nextCursor).not.toBeNull();
  });

  it('checks parameters before the ticker: ?form=4 on GOOG → 400, not 404', () => {
    expect(problemOf(() => service().listCompanyFilings('GOOG', { form: '4' })).status).toBe(400);
  });

  it('checks the ticker before readiness: unknown ticker while loading → 404, not 503', () => {
    expect(problemOf(() => service().listCompanyFilings('GOOG', {})).status).toBe(404);
  });

  it('checks readiness before the lookup: GS with no data → 503', () => {
    expect(problemOf(() => service().listCompanyFilings('GS', {})).status).toBe(503);
  });

  it('getFiling returns the filing with its company dataAsOf', () => {
    expect(service().getFiling('0000320193-24-000081')).toMatchObject({
      filing: { accessionNumber: '0000320193-24-000081', ticker: 'AAPL' },
      dataAsOf: '2026-11-20T16:30:00Z',
    });
  });
});
