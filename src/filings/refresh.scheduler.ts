import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { COMPANIES, type Ticker } from '../companies';
import type { AppConfig } from '../config/config';
import type { AppLogger } from '../common/logger';
import { APP_CONFIG, APP_LOGGER, FILINGS_STORE, SCHEDULER_DEPS } from '../common/tokens';
import { SecError } from '../sec/sec-client';
import type { CompanyState, FilingsStore } from './filings.store';
import { Loader, type LoadResult } from './loader';

export interface SchedulerDeps {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const defaultSchedulerDeps: SchedulerDeps = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** Largest delay setTimeout accepts; above it Node fires after 1 ms. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** What the scheduler needs from the loader. */
export type CompanyLoader = Pick<Loader, 'fullLoad' | 'refresh'>;

type SchedulerConfig = Pick<AppConfig, 'refreshIntervalSeconds' | 'failedCompanyRetrySeconds'>;

/**
 * Runs the loader at startup and then on a timer (spec §9.2). Each run starts
 * REFRESH_INTERVAL_SECONDS after the previous one finished, so runs never overlap.
 */
@Injectable()
export class RefreshScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private running = false;
  private timer: unknown = null;

  constructor(
    @Inject(Loader) private readonly loader: CompanyLoader,
    @Inject(FILINGS_STORE) private readonly store: FilingsStore,
    @Inject(APP_CONFIG) private readonly cfg: SchedulerConfig,
    @Inject(SCHEDULER_DEPS) private readonly deps: SchedulerDeps,
    @Inject(APP_LOGGER) private readonly log: AppLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.start(); // not awaited: liveness answers while loading
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
  }

  /** One pass over the companies in ticker order. Never throws. */
  async runOnce(): Promise<{ nextDelayMs: number }> {
    const intervalMs = this.cfg.refreshIntervalSeconds * 1000;
    let nextDelayMs = intervalMs;
    for (const { ticker } of COMPANIES) {
      const stop = await this.runCompany(ticker);
      if (stop) {
        nextDelayMs = Math.min(
          MAX_TIMER_MS,
          Math.max(intervalMs, (stop.retryAfterSeconds ?? 0) * 1000),
        );
        break;
      }
    }
    const state = this.store.get();
    if (
      !state.firstPassDone &&
      [...state.companies.values()].every((c) => c.status !== 'not_loaded')
    ) {
      this.store.markFirstPassDone();
    }
    return { nextDelayMs };
  }

  private async loop(): Promise<void> {
    if (!this.running) return;
    let nextDelayMs = this.cfg.refreshIntervalSeconds * 1000;
    try {
      ({ nextDelayMs } = await this.runOnce());
    } catch (err) {
      // runOnce catches per company; this guards the rest, so the chain never dies.
      this.log.error({ err }, 'refresh run failed unexpectedly');
    }
    if (!this.running) return;
    this.timer = this.deps.setTimeout(() => void this.loop(), nextDelayMs);
  }

  /** Loads or refreshes one company. Returns the error when the run must stop (429/403). */
  private async runCompany(ticker: Ticker): Promise<SecError | null> {
    const before = this.store.get().companies.get(ticker)!;
    const hasData = before.status === 'loaded' || before.status === 'stale';
    const startedAt = this.deps.now();
    if (!hasData && before.nextFullLoadAt !== null && startedAt < before.nextFullLoadAt) {
      return null; // failed company waiting for its retry time
    }

    let result: LoadResult;
    try {
      result = hasData
        ? await this.loader.refresh(ticker, before.filings)
        : await this.loader.fullLoad(ticker);
    } catch (err) {
      this.log.error({ ticker, err }, 'unexpected error while loading company');
      this.store.setCompany(this.failed(before, hasData, 'internal error', startedAt));
      return null;
    }

    const finishedAt = this.deps.now();
    const line = { ticker, durationMs: finishedAt - startedAt, requests: result.requests };
    if (result.ok) {
      this.store.setCompany({
        ticker,
        status: 'loaded',
        company: result.company,
        filings: result.filings,
        // When the download started: never claim data is fresher than it is.
        dataAsOf: isoSeconds(startedAt),
        lastError: null,
        nextFullLoadAt: null,
      });
      this.log.info(
        { ...line, outcome: 'loaded', rows: result.filings.length },
        'company load finished',
      );
      return null;
    }

    const next = this.failed(before, hasData, result.error.message, finishedAt);
    this.store.setCompany(next);
    const errorKind = result.error instanceof SecError ? result.error.kind : 'invalid_data';
    const failLine = { ...line, outcome: next.status, rows: next.filings.length, errorKind };
    if (errorKind === 'forbidden') {
      this.log.error(failLine, result.error.message);
    } else {
      this.log.warn(failLine, 'company load failed');
    }
    const stopsRun = errorKind === 'rate_limited' || errorKind === 'forbidden';
    return stopsRun ? (result.error as SecError) : null;
  }

  private failed(before: CompanyState, hasData: boolean, error: string, now: number): CompanyState {
    if (hasData) return { ...before, status: 'stale', lastError: error };
    const waitSeconds = Math.max(
      this.cfg.failedCompanyRetrySeconds,
      this.cfg.refreshIntervalSeconds,
    );
    return {
      ...before,
      status: 'failed',
      lastError: error,
      nextFullLoadAt: now + waitSeconds * 1000,
    };
  }
}

/** UTC date-time without milliseconds, e.g. 2026-11-20T16:30:00Z. */
function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
