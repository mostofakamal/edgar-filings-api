import { Inject, Injectable } from '@nestjs/common';
import { COMPANIES, type Ticker } from '../companies';
import type { AppConfig } from '../config/config';
import { companyNotFound, dataUnavailable } from '../common/problem';
import { APP_CONFIG, FILINGS_STORE } from '../common/tokens';
import type { Company, Filing } from './filing';
import type { CompanyState, FilingsStore } from './filings.store';
import { findFiling, listFilings, parseListQuery } from './query';

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
    const filing = findFiling(
      state,
      accession,
      this.cfg.filingsSince,
      this.cfg.refreshIntervalSeconds,
    );
    return { filing, dataAsOf: state.companies.get(filing.ticker)!.dataAsOf! };
  }

  private loadedCompany(ticker: Ticker): CompanyState & { company: Company; dataAsOf: string } {
    const state = this.store.get().companies.get(ticker)!;
    if (state.company === null || state.dataAsOf === null) {
      throw dataUnavailable(
        `Data for ${ticker} has not loaded yet. Try again later.`,
        this.cfg.refreshIntervalSeconds,
      );
    }
    return state as CompanyState & { company: Company; dataAsOf: string };
  }
}

function resolveTicker(text: string): Ticker {
  const upper = text.toUpperCase();
  const match = COMPANIES.find((c) => c.ticker === upper);
  if (!match) throw companyNotFound(text);
  return match.ticker;
}
