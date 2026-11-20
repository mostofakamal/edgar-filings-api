import { Inject, Injectable } from '@nestjs/common';
import { COMPANIES, type Ticker } from '../companies';
import type { AppConfig } from '../config/config';
import { companyNotFound, dataUnavailable } from '../common/problem';
import { APP_CONFIG, CLOCK, FILINGS_STORE } from '../common/tokens';
import type { Company, Filing } from './filing';
import type { CompanyState, FilingsStore } from './filings.store';
import { findFiling, listFilings, parseListQuery } from './query';

export interface Clock {
  now(): number;
}

export const defaultClock: Clock = { now: () => Date.now() };

/**
 * What the controllers call. Applies the spec §7 check order on top of the pure
 * query functions: parameters → ticker → data loaded → lookup.
 */
@Injectable()
export class FilingsQueryService {
  constructor(
    @Inject(FILINGS_STORE) private readonly store: FilingsStore,
    @Inject(APP_CONFIG)
    private readonly cfg: Pick<AppConfig, 'filingsSince' | 'refreshIntervalSeconds'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  getCompany(tickerText: string): { company: Company; dataAsOf: string } {
    const state = this.loadedCompany(resolveTicker(tickerText));
    return { company: state.company, dataAsOf: state.dataAsOf };
  }

  listCompanyFilings(
    tickerText: string,
    query: Record<string, unknown>,
  ): { data: Filing[]; nextCursor: string | null; limit: number; dataAsOf: string } {
    const q = parseListQuery(query, this.cfg.filingsSince);
    const ticker = resolveTicker(tickerText);
    const state = this.loadedCompany(ticker);
    return { ...listFilings(state.filings, ticker, q), limit: q.limit, dataAsOf: state.dataAsOf };
  }

  getFiling(accession: string): { filing: Filing; dataAsOf: string } {
    const state = this.store.get();
    // If companies are missing, the answer can change at the soonest of their next attempts.
    const missing = [...state.companies.values()].filter((c) => c.company === null);
    const retryAfter =
      missing.length > 0
        ? Math.min(...missing.map((c) => this.retryAfterFor(c)))
        : this.cfg.refreshIntervalSeconds;
    const filing = findFiling(state, accession, this.cfg.filingsSince, retryAfter);
    return { filing, dataAsOf: state.companies.get(filing.ticker)!.dataAsOf! };
  }

  private loadedCompany(ticker: Ticker): CompanyState & { company: Company; dataAsOf: string } {
    const state = this.store.get().companies.get(ticker)!;
    if (state.company === null || state.dataAsOf === null) {
      throw dataUnavailable(
        `Data for ${ticker} has not loaded yet. Try again later.`,
        this.retryAfterFor(state),
      );
    }
    return state as CompanyState & { company: Company; dataAsOf: string };
  }

  /** Seconds until this company's data can next change: its next full-load attempt, never below the refresh interval. */
  private retryAfterFor(state: CompanyState): number {
    const interval = this.cfg.refreshIntervalSeconds;
    if (state.nextFullLoadAt === null) return interval;
    return Math.max(interval, Math.ceil((state.nextFullLoadAt - this.clock.now()) / 1000));
  }
}

function resolveTicker(text: string): Ticker {
  const upper = text.toUpperCase();
  const match = COMPANIES.find((c) => c.ticker === upper);
  if (!match) throw companyNotFound(text);
  return match.ticker;
}
