import { Inject, Injectable } from '@nestjs/common';
import { COMPANIES, type Ticker } from '../companies';
import type { AppLogger } from '../common/logger';
import { APP_LOGGER } from '../common/tokens';
import type { Company, Filing } from './filing';

export type CompanyStatus = 'not_loaded' | 'failed' | 'loaded' | 'stale';

export interface CompanyState {
  ticker: Ticker;
  status: CompanyStatus;
  company: Company | null;
  filings: readonly Filing[];
  /** When this company's `recent` file was last downloaded successfully (UTC). */
  dataAsOf: string | null;
  lastError: string | null;
  /** For failed companies: earliest time (epoch ms) to try the full load again. */
  nextFullLoadAt: number | null;
}

export interface StoreState {
  companies: ReadonlyMap<Ticker, CompanyState>;
  byAccession: ReadonlyMap<string, Filing>;
  /** True once every company has been tried at least once. */
  firstPassDone: boolean;
}

/** Holds the current state. Behind an interface so a shared store can replace it (spec §12). */
export interface FilingsStore {
  get(): StoreState;
  setCompany(state: CompanyState): void;
  markFirstPassDone(): void;
}

export function isReady(state: StoreState): boolean {
  return (
    state.firstPassDone &&
    [...state.companies.values()].some((c) => c.status === 'loaded' || c.status === 'stale')
  );
}

/** In-memory store. Every change builds a new frozen state, so a running request sees one consistent state. */
@Injectable()
export class InMemoryFilingsStore implements FilingsStore {
  private state: StoreState;

  constructor(@Inject(APP_LOGGER) private readonly log: AppLogger) {
    const companies = new Map<Ticker, CompanyState>();
    for (const { ticker } of COMPANIES) {
      companies.set(ticker, {
        ticker,
        status: 'not_loaded',
        company: null,
        filings: [],
        dataAsOf: null,
        lastError: null,
        nextFullLoadAt: null,
      });
    }
    this.state = this.build(companies, false);
  }

  get(): StoreState {
    return this.state;
  }

  setCompany(company: CompanyState): void {
    const companies = new Map(this.state.companies);
    companies.set(company.ticker, Object.freeze({ ...company }));
    this.state = this.build(companies, this.state.firstPassDone);
  }

  markFirstPassDone(): void {
    this.state = this.build(new Map(this.state.companies), true);
  }

  private build(companies: Map<Ticker, CompanyState>, firstPassDone: boolean): StoreState {
    const byAccession = new Map<string, Filing>();
    for (const { ticker } of COMPANIES) {
      for (const f of companies.get(ticker)?.filings ?? []) {
        const kept = byAccession.get(f.accessionNumber);
        if (kept) {
          this.log.warn(
            { accessionNumber: f.accessionNumber, kept: kept.ticker, also: ticker },
            'accession listed under two companies',
          );
          continue;
        }
        byAccession.set(f.accessionNumber, f);
      }
    }
    return Object.freeze({ companies, byAccession, firstPassDone });
  }
}
