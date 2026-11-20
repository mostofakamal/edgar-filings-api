import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../config/config';
import type { AppLogger } from '../common/logger';
import { APP_CONFIG, APP_LOGGER, SEC_CLIENT_DEPS } from '../common/tokens';

export type SecErrorKind =
  'timeout' | 'network' | 'rate_limited' | 'forbidden' | 'http_error' | 'not_json';

export class SecError extends Error {
  override name = 'SecError';
  constructor(
    readonly kind: SecErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** What the rest of the app needs from SEC: one raw JSON file by name. */
export interface SecSource {
  getJson(fileName: string): Promise<unknown>;
}

export interface SecClientDeps {
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  now(): number;
  random(): number;
}

const FILE_NAME = /^CIK\d{10}(-submissions-\d{3})?\.json$/;
/** Each retry wait is changed by a random amount of up to ±25% (spec §9.3). */
const JITTER = 0.25;

export type SecClientConfig = Pick<
  AppConfig,
  | 'secUserAgent'
  | 'secRequestTimeoutMs'
  | 'secBaseUrl'
  | 'secMaxRequestsPerSecond'
  | 'secMaxRetries'
  | 'secRetryBaseDelayMs'
>;

/** The only code that makes HTTP calls to SEC. Knows nothing about SEC's JSON shape. */
@Injectable()
export class SecClient implements SecSource {
  private lastStart: number | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: SecClientConfig,
    @Inject(SEC_CLIENT_DEPS) private readonly deps: SecClientDeps,
    @Inject(APP_LOGGER) private readonly log: Pick<AppLogger, 'warn'>,
  ) {}

  async getJson(fileName: string): Promise<unknown> {
    if (!FILE_NAME.test(fileName)) throw new Error(`Invalid SEC file name: ${fileName}`);
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.attempt(fileName);
      } catch (e) {
        if (!(e instanceof SecError) || !isRetryable(e) || attempt > this.cfg.secMaxRetries)
          throw e;
        this.log.warn({ fileName, attempt, kind: e.kind }, 'SEC request failed, retrying');
        // Waits double: base, 2 × base, 4 × base, … each ±25%.
        const wait = this.cfg.secRetryBaseDelayMs * 2 ** (attempt - 1);
        await this.deps.sleep(wait * (1 - JITTER + this.deps.random() * 2 * JITTER));
      }
    }
  }

  private async attempt(fileName: string): Promise<unknown> {
    await this.waitForSpacing();
    let res: Response;
    let body: string;
    try {
      res = await this.deps.fetch(`${this.cfg.secBaseUrl}/${fileName}`, {
        headers: {
          'User-Agent': this.cfg.secUserAgent,
          'Accept-Encoding': 'gzip, deflate',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.cfg.secRequestTimeoutMs),
      });
      body = await res.text();
    } catch (e) {
      // Check the name, not instanceof: fetch rejects with a DOMException, which can come
      // from another realm (e.g. Jest's VM context) and then fails `instanceof Error`.
      const name = typeof e === 'object' && e !== null && 'name' in e ? e.name : undefined;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new SecError('timeout', `SEC request timed out: ${fileName}`);
      }
      throw new SecError('network', `SEC request failed: ${fileName}: ${String(e)}`);
    }
    if (res.status === 429) {
      throw new SecError('rate_limited', 'SEC returned 429', 429, retryAfter(res));
    }
    if (res.status === 403) {
      throw new SecError(
        'forbidden',
        'SEC returned 403: User-Agent rejected, check SEC_USER_AGENT',
        403,
      );
    }
    if (res.status !== 200) {
      throw new SecError('http_error', `SEC returned ${res.status}`, res.status);
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new SecError('not_json', `SEC returned a body that is not JSON: ${fileName}`, 200);
    }
  }

  private async waitForSpacing(): Promise<void> {
    if (this.lastStart !== null) {
      const spacing = Math.ceil(1000 / this.cfg.secMaxRequestsPerSecond);
      const wait = this.lastStart + spacing - this.deps.now();
      if (wait > 0) await this.deps.sleep(wait);
    }
    this.lastStart = this.deps.now();
  }
}

function isRetryable(e: SecError): boolean {
  return (
    e.kind === 'timeout' ||
    e.kind === 'network' ||
    (e.kind === 'http_error' && e.status !== undefined && e.status >= 500)
  );
}

function retryAfter(res: Response): number | undefined {
  const v = res.headers.get('retry-after');
  return v !== null && /^\d+$/.test(v) ? Number(v) : undefined;
}
