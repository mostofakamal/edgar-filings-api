import { Inject, Injectable } from '@nestjs/common';
import { COMPANIES, type Ticker } from '../companies';
import type { AppConfig } from '../config/config';
import type { AppLogger } from '../common/logger';
import { APP_CONFIG, APP_LOGGER, SEC_SOURCE } from '../common/tokens';
import {
  parseOverflow,
  parseSubmissions,
  SecDataError,
  type ParsedSubmissions,
  type SecFilingRow,
} from '../sec/sec-adapter';
import { SecError, type SecSource } from '../sec/sec-client';
import { compareFilings, toFiling, type Company, type Filing } from './filing';
import { mergeRefresh } from './merge';

export type LoadResult =
  | { ok: true; company: Company; filings: Filing[]; requests: number }
  | { ok: false; error: SecError | SecDataError; requests: number };

/** Decides what to fetch from SEC for one company, checks it through the adapter and merges (spec §9.1, §9.2). */
@Injectable()
export class Loader {
  constructor(
    @Inject(SEC_SOURCE) private readonly source: SecSource,
    @Inject(APP_CONFIG)
    private readonly cfg: Pick<AppConfig, 'filingsSince' | 'secArchivesBaseUrl'>,
    @Inject(APP_LOGGER) private readonly log: AppLogger,
  ) {}

  /** Downloads the submissions file and as many overflow files as FILINGS_SINCE needs. All or nothing. */
  async fullLoad(ticker: Ticker): Promise<LoadResult> {
    const counter = { requests: 0 };
    return this.guard(counter, async () => {
      const sub = await this.fetchSubmissions(ticker, counter);
      const rows = [...sub.rows];
      let reachedSince = this.isBeforeSince(sub.oldestFilingDate);
      for (const file of sub.overflowFiles) {
        if (reachedSince) break;
        counter.requests++;
        const overflow = parseOverflow(await this.source.getJson(file));
        rows.push(...overflow.rows);
        reachedSince = this.isBeforeSince(overflow.oldestFilingDate);
      }
      return { company: this.company(ticker, sub), filings: this.toFilings(ticker, rows) };
    });
  }

  /** Downloads only the submissions file and merges it with the previous filings. */
  async refresh(ticker: Ticker, previous: readonly Filing[]): Promise<LoadResult> {
    const counter = { requests: 0 };
    return this.guard(counter, async () => {
      const sub = await this.fetchSubmissions(ticker, counter);
      const fresh = this.toFilings(ticker, sub.rows);
      return {
        company: this.company(ticker, sub),
        filings: mergeRefresh(previous, fresh, sub.oldestFilingDate),
      };
    });
  }

  private async guard(
    counter: { requests: number },
    work: () => Promise<{ company: Company; filings: Filing[] }>,
  ): Promise<LoadResult> {
    try {
      return { ok: true, ...(await work()), requests: counter.requests };
    } catch (e) {
      if (e instanceof SecError || e instanceof SecDataError) {
        return { ok: false, error: e, requests: counter.requests };
      }
      throw e; // a bug, not a SEC failure
    }
  }

  private async fetchSubmissions(
    ticker: Ticker,
    counter: { requests: number },
  ): Promise<ParsedSubmissions> {
    const cik = cikOf(ticker);
    counter.requests++;
    return parseSubmissions(await this.source.getJson(`CIK${cik}.json`), cik);
  }

  private isBeforeSince(oldest: string | null): boolean {
    return oldest !== null && oldest < this.cfg.filingsSince;
  }

  /** Core rows since FILINGS_SINCE, unique by accession (first seen wins: recent before overflow), newest first. */
  private toFilings(ticker: Ticker, rows: readonly SecFilingRow[]): Filing[] {
    const cik = cikOf(ticker);
    const byAccession = new Map<string, Filing>();
    for (const row of rows) {
      if (row.filingDate < this.cfg.filingsSince || byAccession.has(row.accessionNumber)) continue;
      byAccession.set(row.accessionNumber, toFiling(row, ticker, cik, this.cfg.secArchivesBaseUrl));
    }
    return [...byAccession.values()].sort(compareFilings);
  }

  private company(ticker: Ticker, sub: ParsedSubmissions): Company {
    const index = sub.tickers.indexOf(ticker);
    if (index < 0) {
      this.log.warn(
        { ticker, secTickers: sub.tickers },
        'SEC does not list our ticker for this company',
      );
    }
    return {
      ticker,
      cik: sub.cik,
      name: sub.name,
      exchange: index < 0 ? null : (sub.exchanges[index] ?? null),
      filingsAvailableFrom: this.cfg.filingsSince,
    };
  }
}

function cikOf(ticker: Ticker): string {
  const c = COMPANIES.find((x) => x.ticker === ticker);
  if (!c) throw new Error(`unknown ticker ${ticker}`);
  return c.cik;
}
