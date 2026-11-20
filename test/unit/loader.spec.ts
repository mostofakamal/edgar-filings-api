import { Loader, type LoadResult } from '../../src/filings/loader';
import { SecError } from '../../src/sec/sec-client';
import { SecDataError } from '../../src/sec/sec-adapter';
import type { AppLogger } from '../../src/common/logger';
import { FakeSecClient } from '../fakes/fake-sec-client';
import { overflowFixture, submissionsFixture } from '../support/fixtures';

const GS_FILES = {
  'CIK0000886982.json': submissionsFixture('CIK0000886982.json'),
  'CIK0000886982-submissions-001.json': overflowFixture('CIK0000886982-submissions-001.json'),
  'CIK0000886982-submissions-022.json': overflowFixture('CIK0000886982-submissions-022.json'),
};
const AAPL_FILES = { 'CIK0000320193.json': submissionsFixture('CIK0000320193.json') };

function setup(files: Record<string, unknown>, filingsSince = '2021-01-01') {
  const source = new FakeSecClient(files);
  const warn = jest.fn<void, [object, string]>();
  const log: AppLogger = { info: jest.fn(), warn, error: jest.fn() };
  const cfg = { filingsSince, secArchivesBaseUrl: 'https://www.sec.gov/Archives/edgar/data' };
  return { source, warn, loader: new Loader(source, cfg, log) };
}

function ok(r: LoadResult) {
  if (!r.ok) throw new Error(`expected success, got ${r.error.message}`);
  return r;
}

const dates = (r: LoadResult) => ok(r).filings.map((f) => `${f.filingDate} ${f.form}`);

describe('Loader.fullLoad', () => {
  it('does not fetch overflow files when recent already reaches before FILINGS_SINCE', async () => {
    const { source, loader } = setup(AAPL_FILES);
    const r = ok(await loader.fullLoad('AAPL'));
    expect(source.calls).toEqual(['CIK0000320193.json']);
    expect(r.requests).toBe(1);
    expect(r.filings.map((f) => f.accessionNumber)).toEqual([
      '0000320193-26-000026',
      '0001140361-26-035325',
      '0000320193-26-000020',
      '0000320193-24-000081',
    ]);
  });

  it('builds the company, with the exchange at our ticker index and filingsAvailableFrom', async () => {
    const { loader } = setup(AAPL_FILES);
    expect(ok(await loader.fullLoad('AAPL')).company).toEqual({
      ticker: 'AAPL',
      cik: '0000320193',
      name: 'Apple Inc.',
      exchange: 'Nasdaq',
      filingsAvailableFrom: '2021-01-01',
    });
  });

  it('fetches overflow files newest first and stops after the first one older than FILINGS_SINCE', async () => {
    const { source, loader } = setup(GS_FILES);
    const r = ok(await loader.fullLoad('GS'));
    expect(source.calls).toEqual([
      'CIK0000886982.json',
      'CIK0000886982-submissions-001.json',
      'CIK0000886982-submissions-022.json',
    ]);
    expect(r.requests).toBe(3);
    expect(dates(r)).toEqual([
      '2026-11-13 8-K',
      '2026-11-02 10-Q',
      '2026-10-13 8-K',
      '2025-10-31 10-Q',
      '2025-10-21 8-K',
      '2021-03-08 8-K',
      '2021-03-04 8-K',
    ]);
  });

  it('stops after the first file whose oldest row is before FILINGS_SINCE', async () => {
    const { source, loader } = setup(GS_FILES, '2025-10-01');
    await loader.fullLoad('GS');
    expect(source.calls).toEqual(['CIK0000886982.json', 'CIK0000886982-submissions-001.json']);
  });

  it('stops when the overflow list ends', async () => {
    const { source, loader } = setup(GS_FILES, '2000-01-01');
    ok(await loader.fullLoad('GS'));
    expect(source.calls).toHaveLength(3);
  });

  it('keeps only core forms with filingDate >= FILINGS_SINCE', async () => {
    const { loader } = setup(GS_FILES, '2021-03-05');
    const r = ok(await loader.fullLoad('GS'));
    expect(dates(r)).toContain('2021-03-08 8-K');
    expect(dates(r)).not.toContain('2021-03-04 8-K');
    expect(r.filings.every((f) => !f.form.startsWith('424'))).toBe(true);
  });

  it('fails and returns no filings if any file fails', async () => {
    const network = new SecError('network', 'boom');
    const { loader } = setup({ ...GS_FILES, 'CIK0000886982-submissions-022.json': network });
    const r = await loader.fullLoad('GS');
    expect(r).toEqual({ ok: false, error: network, requests: 3 });
  });

  it('fails on adapter rejection', async () => {
    const bad = submissionsFixture('CIK0000320193.json');
    bad.cik = '0000000001';
    const { loader } = setup({ 'CIK0000320193.json': bad });
    const r = await loader.fullLoad('AAPL');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBeInstanceOf(SecDataError);
  });

  it('logs a warning when SEC tickers do not contain our ticker, and still loads with exchange null', async () => {
    const raw = submissionsFixture('CIK0000320193.json');
    raw.tickers = ['XYZ'];
    const { loader, warn } = setup({ 'CIK0000320193.json': raw });
    const r = ok(await loader.fullLoad('AAPL'));
    expect(r.company.exchange).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      { ticker: 'AAPL', secTickers: ['XYZ'] },
      'SEC does not list our ticker for this company',
    );
  });

  it('rethrows unexpected errors (bugs) instead of reporting a SEC failure', async () => {
    const { loader } = setup({});
    await expect(loader.fullLoad('AAPL')).rejects.toThrow('unexpected SEC request');
  });
});

describe('Loader.refresh', () => {
  it('fetches only the submissions file and merges with the previous filings', async () => {
    const { source, loader } = setup(GS_FILES);
    const full = ok(await loader.fullLoad('GS'));
    source.calls.length = 0;
    const r = ok(await loader.refresh('GS', full.filings));
    expect(source.calls).toEqual(['CIK0000886982.json']);
    expect(r.requests).toBe(1);
    expect(r.filings).toEqual(full.filings);
  });

  it('applies the core-form and FILINGS_SINCE filter to fresh rows', async () => {
    const { loader } = setup(GS_FILES, '2026-11-01');
    const r = ok(await loader.refresh('GS', []));
    expect(dates(r)).toEqual(['2026-11-13 8-K', '2026-11-02 10-Q']);
  });

  it('returns the failure when the submissions file fails', async () => {
    const rate = new SecError('rate_limited', 'slow down', 429, 30);
    const { loader } = setup({ 'CIK0000886982.json': rate });
    expect(await loader.refresh('GS', [])).toEqual({ ok: false, error: rate, requests: 1 });
  });
});
