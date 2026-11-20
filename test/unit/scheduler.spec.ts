import { RefreshScheduler, type SchedulerDeps } from '../../src/filings/refresh.scheduler';
import { InMemoryFilingsStore } from '../../src/filings/filings.store';
import type { LoadResult } from '../../src/filings/loader';
import type { Filing } from '../../src/filings/filing';
import { COMPANIES, type Ticker } from '../../src/companies';
import { SecError } from '../../src/sec/sec-client';

const CFG = { refreshIntervalSeconds: 60, failedCompanyRetrySeconds: 300 };
const T0 = Date.parse('2026-11-20T16:30:00Z');

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

const success = (ticker: Ticker, accessions: string[] = [`${ticker}-1`]): LoadResult => ({
  ok: true,
  company: {
    ticker,
    cik: '0000000000',
    name: ticker,
    exchange: null,
    filingsAvailableFrom: '2021-01-01',
  },
  filings: accessions.map((a) => filing(ticker, a)),
  requests: 1,
});
const failure = (error: SecError): LoadResult => ({ ok: false, error, requests: 1 });

function setup() {
  let now = T0;
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const deps: SchedulerDeps = {
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: jest.fn(),
  };
  const fullLoad = jest.fn<Promise<LoadResult>, [Ticker]>((t) => Promise.resolve(success(t)));
  const refresh = jest.fn<Promise<LoadResult>, [Ticker, readonly Filing[]]>((t) =>
    Promise.resolve(success(t, [`${t}-1`, `${t}-2`])),
  );
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn<void, [object, string]>() };
  const store = new InMemoryFilingsStore(log);
  const scheduler = new RefreshScheduler({ fullLoad, refresh }, store, CFG, deps, log);
  return {
    scheduler,
    store,
    fullLoad,
    refresh,
    timers,
    log,
    advance: (ms: number) => {
      now += ms;
    },
    state: (t: Ticker) => store.get().companies.get(t)!,
  };
}

describe('RefreshScheduler.runOnce', () => {
  it('first run full-loads every company in ticker order and marks the first pass done', async () => {
    const h = setup();
    const r = await h.scheduler.runOnce();
    expect(h.fullLoad.mock.calls.map((c) => c[0])).toEqual(COMPANIES.map((c) => c.ticker));
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.state('AAPL')).toMatchObject({
      status: 'loaded',
      dataAsOf: '2026-11-20T16:30:00Z',
      lastError: null,
    });
    expect(h.store.get().firstPassDone).toBe(true);
    expect(r.nextDelayMs).toBe(60_000);
  });

  it('a failed full load sets failed, lastError and nextFullLoadAt = now + max(retry, interval)', async () => {
    const h = setup();
    h.fullLoad.mockImplementation((t) =>
      Promise.resolve(t === 'GS' ? failure(new SecError('network', 'fetch failed')) : success(t)),
    );
    await h.scheduler.runOnce();
    expect(h.state('GS')).toMatchObject({
      status: 'failed',
      company: null,
      lastError: 'fetch failed',
      nextFullLoadAt: T0 + 300_000,
    });
    expect(h.state('META').status).toBe('loaded');
  });

  it('uses the refresh interval for nextFullLoadAt when it is longer than the retry setting', async () => {
    const h = setup();
    const s = new RefreshScheduler(
      {
        fullLoad: () => Promise.resolve(failure(new SecError('network', 'x'))),
        refresh: h.refresh,
      },
      h.store,
      { refreshIntervalSeconds: 900, failedCompanyRetrySeconds: 300 },
      { now: () => T0, setTimeout: () => 0, clearTimeout: () => undefined },
      h.log,
    );
    await s.runOnce();
    expect(h.state('AAPL').nextFullLoadAt).toBe(T0 + 900_000);
  });

  it('skips a failed company until nextFullLoadAt, then full-loads it again', async () => {
    const h = setup();
    h.fullLoad.mockImplementationOnce(() => Promise.resolve(failure(new SecError('network', 'x'))));
    await h.scheduler.runOnce();
    h.fullLoad.mockClear();
    h.advance(60_000);
    await h.scheduler.runOnce();
    expect(h.fullLoad).not.toHaveBeenCalled();
    expect(h.state('AAPL').status).toBe('failed');
    h.advance(240_000);
    await h.scheduler.runOnce();
    expect(h.fullLoad.mock.calls.map((c) => c[0])).toEqual(['AAPL']);
    expect(h.state('AAPL').status).toBe('loaded');
  });

  it('a loaded company refreshes with its previous filings', async () => {
    const h = setup();
    await h.scheduler.runOnce();
    await h.scheduler.runOnce();
    expect(h.refresh).toHaveBeenCalledTimes(6);
    expect(h.refresh.mock.calls[0]![0]).toBe('AAPL');
    expect(h.refresh.mock.calls[0]![1].map((f) => f.accessionNumber)).toEqual(['AAPL-1']);
    expect(h.state('AAPL').filings.map((f) => f.accessionNumber)).toEqual(['AAPL-1', 'AAPL-2']);
  });

  it('a refresh failure sets stale and keeps filings and dataAsOf; a later success sets loaded and a new dataAsOf', async () => {
    const h = setup();
    await h.scheduler.runOnce();
    h.advance(60_000);
    h.refresh.mockImplementationOnce(() =>
      Promise.resolve(failure(new SecError('http_error', 'SEC returned 503', 503))),
    );
    await h.scheduler.runOnce();
    expect(h.state('AAPL')).toMatchObject({
      status: 'stale',
      dataAsOf: '2026-11-20T16:30:00Z',
      lastError: 'SEC returned 503',
    });
    expect(h.state('AAPL').filings.map((f) => f.accessionNumber)).toEqual(['AAPL-1']);
    h.advance(60_000);
    await h.scheduler.runOnce();
    expect(h.state('AAPL')).toMatchObject({
      status: 'loaded',
      dataAsOf: '2026-11-20T16:32:00Z',
      lastError: null,
    });
  });

  it('not_json during refresh sets stale and the run continues', async () => {
    const h = setup();
    await h.scheduler.runOnce();
    h.refresh.mockImplementation((t) =>
      Promise.resolve(
        t === 'AAPL' ? failure(new SecError('not_json', 'not JSON', 200)) : success(t),
      ),
    );
    await h.scheduler.runOnce();
    expect(h.state('AAPL').status).toBe('stale');
    expect(h.refresh).toHaveBeenCalledTimes(6);
  });

  it('429 stops the run; companies after it are untouched; nextDelayMs = max(interval, Retry-After)', async () => {
    const h = setup();
    await h.scheduler.runOnce();
    h.refresh.mockImplementation((t) =>
      Promise.resolve(
        t === 'AMZN'
          ? failure(new SecError('rate_limited', 'SEC returned 429', 429, 120))
          : success(t),
      ),
    );
    const before = h.state('GOOGL');
    const r = await h.scheduler.runOnce();
    expect(h.refresh.mock.calls.map((c) => c[0])).toEqual(['AAPL', 'AMZN']);
    expect(h.state('AMZN').status).toBe('stale');
    expect(h.state('GOOGL')).toBe(before);
    expect(r.nextDelayMs).toBe(120_000);
  });

  it('429 without Retry-After waits the refresh interval', async () => {
    const h = setup();
    h.fullLoad.mockImplementation(() =>
      Promise.resolve(failure(new SecError('rate_limited', '429', 429))),
    );
    expect((await h.scheduler.runOnce()).nextDelayMs).toBe(60_000);
  });

  it('403 stops the run and is logged as an error', async () => {
    const h = setup();
    h.fullLoad.mockImplementation(() =>
      Promise.resolve(
        failure(
          new SecError(
            'forbidden',
            'SEC returned 403: User-Agent rejected, check SEC_USER_AGENT',
            403,
          ),
        ),
      ),
    );
    await h.scheduler.runOnce();
    expect(h.fullLoad).toHaveBeenCalledTimes(1);
    expect(h.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: 'AAPL', errorKind: 'forbidden' }),
      expect.stringContaining('SEC_USER_AGENT'),
    );
  });

  it('does not mark the first pass done when a 429 stopped it before every company was tried', async () => {
    const h = setup();
    h.fullLoad.mockImplementation((t) =>
      Promise.resolve(
        t === 'AMZN' ? failure(new SecError('rate_limited', '429', 429)) : success(t),
      ),
    );
    await h.scheduler.runOnce();
    expect(h.store.get().firstPassDone).toBe(false);
    h.fullLoad.mockImplementation((t) => Promise.resolve(success(t)));
    h.advance(300_000);
    await h.scheduler.runOnce();
    expect(h.store.get().firstPassDone).toBe(true);
  });

  it('an unexpected error in one company is logged, keeps its data, and the run continues', async () => {
    const h = setup();
    await h.scheduler.runOnce();
    h.refresh.mockImplementation((t) =>
      t === 'AAPL' ? Promise.reject(new Error('bug')) : Promise.resolve(success(t)),
    );
    await h.scheduler.runOnce();
    expect(h.state('AAPL')).toMatchObject({ status: 'stale', lastError: 'internal error' });
    expect(h.state('AAPL').filings).toHaveLength(1);
    expect(h.refresh).toHaveBeenCalledTimes(6);
    expect(h.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: 'AAPL', err: expect.any(Error) as Error }),
      'unexpected error while loading company',
    );
  });

  it('logs one line per company per run', async () => {
    const h = setup();
    await h.scheduler.runOnce();
    expect(h.log.info).toHaveBeenCalledWith(
      { ticker: 'AAPL', outcome: 'loaded', durationMs: 0, requests: 1, rows: 1 },
      'company load finished',
    );
  });
});

describe('RefreshScheduler.start/stop', () => {
  it('schedules the next run only after the current one finishes (runs never overlap)', async () => {
    const h = setup();
    let release: () => void = () => undefined;
    h.fullLoad.mockImplementation(
      (t) =>
        new Promise((resolve) => {
          release = () => resolve(success(t));
        }),
    );
    h.scheduler.start();
    await Promise.resolve();
    expect(h.timers).toHaveLength(0);
    for (let i = 0; i < 6; i++) {
      release();
      await new Promise((r) => setImmediate(r));
    }
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(60_000);
    h.scheduler.stop();
  });

  it('runs again when the timer fires, and stop() cancels the next run', async () => {
    const h = setup();
    h.scheduler.start();
    await new Promise((r) => setImmediate(r));
    expect(h.timers).toHaveLength(1);
    h.timers[0]!.fn();
    await new Promise((r) => setImmediate(r));
    expect(h.refresh).toHaveBeenCalledTimes(6);
    h.scheduler.stop();
    expect(h.timers).toHaveLength(2);
  });

  it('onApplicationBootstrap starts and onModuleDestroy stops', async () => {
    const h = setup();
    h.scheduler.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    expect(h.fullLoad).toHaveBeenCalledTimes(6);
    h.scheduler.onModuleDestroy();
    h.timers[0]!.fn();
    await new Promise((r) => setImmediate(r));
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
