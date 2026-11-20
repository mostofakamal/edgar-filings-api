import { InMemoryFilingsStore, isReady, type CompanyState } from '../../src/filings/filings.store';
import type { Filing } from '../../src/filings/filing';
import type { Ticker } from '../../src/companies';

const filing = (ticker: Ticker, accessionNumber: string): Filing => ({
  accessionNumber,
  ticker,
  cik: '0000000000',
  form: '8-K',
  filingDate: '2026-11-01',
  reportDate: null,
  acceptanceDateTime: '2026-11-01T12:00:00Z',
  primaryDocumentUrl: null,
});

const loaded = (ticker: Ticker, filings: Filing[]): CompanyState => ({
  ticker,
  status: 'loaded',
  company: {
    ticker,
    cik: '0000000000',
    name: ticker,
    exchange: null,
    filingsAvailableFrom: '2021-01-01',
  },
  filings,
  dataAsOf: '2026-11-20T16:30:00Z',
  lastError: null,
  nextFullLoadAt: null,
  failures: 0,
});

function makeStore() {
  const warn = jest.fn<void, [object, string]>();
  return { warn, store: new InMemoryFilingsStore({ info: jest.fn(), warn, error: jest.fn() }) };
}

describe('InMemoryFilingsStore', () => {
  it('starts with six not_loaded companies in ticker order and is not ready', () => {
    const { store } = makeStore();
    const s = store.get();
    expect([...s.companies.keys()]).toEqual(['AAPL', 'AMZN', 'GOOGL', 'GS', 'META', 'NFLX']);
    expect(
      [...s.companies.values()].every((c) => c.status === 'not_loaded' && c.filings.length === 0),
    ).toBe(true);
    expect(s.firstPassDone).toBe(false);
    expect(isReady(s)).toBe(false);
  });

  it('get() returns the same object until a change, then a new one; the old one is unchanged', () => {
    const { store } = makeStore();
    const before = store.get();
    expect(store.get()).toBe(before);
    store.setCompany(loaded('AAPL', [filing('AAPL', 'a-1')]));
    const after = store.get();
    expect(after).not.toBe(before);
    expect(before.companies.get('AAPL')!.status).toBe('not_loaded');
    expect(after.companies.get('AAPL')!.status).toBe('loaded');
    expect(Object.isFrozen(after)).toBe(true);
  });

  it('indexes every filing by accession', () => {
    const { store } = makeStore();
    store.setCompany(loaded('AAPL', [filing('AAPL', 'a-1'), filing('AAPL', 'a-2')]));
    store.setCompany(loaded('GS', [filing('GS', 'g-1')]));
    expect([...store.get().byAccession.keys()].sort()).toEqual(['a-1', 'a-2', 'g-1']);
    expect(store.get().byAccession.get('g-1')!.ticker).toBe('GS');
  });

  it('on a duplicate accession keeps the first company in ticker order and logs a warning', () => {
    const { store, warn } = makeStore();
    store.setCompany(loaded('GS', [filing('GS', 'dup')]));
    store.setCompany(loaded('AAPL', [filing('AAPL', 'dup')]));
    expect(store.get().byAccession.get('dup')!.ticker).toBe('AAPL');
    expect(warn).toHaveBeenCalledWith(
      { accessionNumber: 'dup', kept: 'AAPL', also: 'GS' },
      'accession listed under two companies',
    );
  });

  it('is ready after the first pass with one loaded company', () => {
    const { store } = makeStore();
    store.setCompany(loaded('AAPL', []));
    expect(isReady(store.get())).toBe(false);
    store.markFirstPassDone();
    expect(isReady(store.get())).toBe(true);
  });

  it('is ready with only a stale company', () => {
    const { store } = makeStore();
    store.setCompany({ ...loaded('AAPL', []), status: 'stale' });
    store.markFirstPassDone();
    expect(isReady(store.get())).toBe(true);
  });

  it('is not ready after the first pass with none loaded', () => {
    const { store } = makeStore();
    store.setCompany({ ...loaded('AAPL', []), status: 'failed', company: null });
    store.markFirstPassDone();
    expect(isReady(store.get())).toBe(false);
  });
});
