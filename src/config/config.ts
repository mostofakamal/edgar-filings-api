import { z } from 'zod';

export interface AppConfig {
  secUserAgent: string;
  port: number;
  refreshIntervalSeconds: number;
  filingsSince: string;
  secRequestTimeoutMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Base URL of SEC's submissions files, without a trailing slash. */
  secBaseUrl: string;
  /** Base URL used to build primaryDocumentUrl, without a trailing slash. */
  secArchivesBaseUrl: string;
  secMaxRequestsPerSecond: number;
  secMaxRetries: number;
  secRetryBaseDelayMs: number;
  failedCompanyRetrySeconds: number;
  /** Cap for the exponential backoff of a company that keeps failing. */
  failedCompanyRetryMaxSeconds: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const DEFAULTS = {
  PORT: '3000',
  REFRESH_INTERVAL_SECONDS: '60',
  FILINGS_SINCE: '2021-01-01',
  SEC_REQUEST_TIMEOUT_MS: '10000',
  LOG_LEVEL: 'info',
  SEC_BASE_URL: 'https://data.sec.gov/submissions',
  SEC_ARCHIVES_BASE_URL: 'https://www.sec.gov/Archives/edgar/data',
  SEC_MAX_REQUESTS_PER_SECOND: '5',
  SEC_MAX_RETRIES: '2',
  SEC_RETRY_BASE_DELAY_MS: '1000',
  FAILED_COMPANY_RETRY_SECONDS: '300',
  FAILED_COMPANY_RETRY_MAX_SECONDS: '3600',
} as const;

type VarName = keyof typeof DEFAULTS | 'SEC_USER_AGENT';

/** True when `s` is YYYY-MM-DD and names a real calendar day. */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const integer = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, `must be an integer from ${min} to ${max}`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `must be an integer from ${min} to ${max}`);

const atLeast = (min: number) =>
  z
    .string()
    .regex(/^\d+$/, `must be an integer of at least ${min}`)
    .transform(Number)
    .refine((n) => n >= min, `must be an integer of at least ${min}`);

/** An http(s) URL; stored without a trailing slash. */
const baseUrl = z
  .string()
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'must be an http or https URL')
  .transform((s) => s.replace(/\/+$/, ''));

function schema(today: string) {
  return z
    .object({
      SEC_USER_AGENT: z
        .string({ error: 'is required' })
        .min(1, 'is required')
        .refine((s) => s.includes(' ') && s.includes('@'), {
          message: 'must look like "Company Name contact@domain"',
        }),
      PORT: integer(1, 65535),
      REFRESH_INTERVAL_SECONDS: atLeast(10),
      FILINGS_SINCE: z
        .string()
        .refine(isRealDate, 'must be a real date in YYYY-MM-DD format')
        .refine((s) => s <= today, 'must not be in the future'),
      SEC_REQUEST_TIMEOUT_MS: integer(1000, 60000),
      LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error'], {
        error: 'must be one of debug, info, warn, error',
      }),
      SEC_BASE_URL: baseUrl,
      SEC_ARCHIVES_BASE_URL: baseUrl,
      // Capped at 5: half of SEC's 10 per second, which counts all our machines (spec §3).
      SEC_MAX_REQUESTS_PER_SECOND: integer(1, 5),
      SEC_MAX_RETRIES: integer(0, 5),
      SEC_RETRY_BASE_DELAY_MS: integer(100, 60000),
      FAILED_COMPANY_RETRY_SECONDS: atLeast(10),
      FAILED_COMPANY_RETRY_MAX_SECONDS: atLeast(10),
    })
    .refine((c) => c.FAILED_COMPANY_RETRY_MAX_SECONDS >= c.FAILED_COMPANY_RETRY_SECONDS, {
      path: ['FAILED_COMPANY_RETRY_MAX_SECONDS'],
      message: 'must not be below FAILED_COMPANY_RETRY_SECONDS',
    });
}

/** Reads and checks configuration from environment variables (spec §10). Throws ConfigError listing every problem. */
export function loadConfig(
  env: Record<string, string | undefined>,
  today: Date = new Date(),
): AppConfig {
  const input: Partial<Record<VarName, string>> = { SEC_USER_AGENT: env.SEC_USER_AGENT };
  for (const [name, value] of Object.entries(DEFAULTS)) {
    input[name as keyof typeof DEFAULTS] = env[name] ?? value;
  }
  const result = schema(today.toISOString().slice(0, 10)).safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${String(i.path[0])} ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n- ${[...new Set(lines)].join('\n- ')}`);
  }
  const c = result.data;
  return {
    secUserAgent: c.SEC_USER_AGENT,
    port: c.PORT,
    refreshIntervalSeconds: c.REFRESH_INTERVAL_SECONDS,
    filingsSince: c.FILINGS_SINCE,
    secRequestTimeoutMs: c.SEC_REQUEST_TIMEOUT_MS,
    logLevel: c.LOG_LEVEL,
    secBaseUrl: c.SEC_BASE_URL,
    secArchivesBaseUrl: c.SEC_ARCHIVES_BASE_URL,
    secMaxRequestsPerSecond: c.SEC_MAX_REQUESTS_PER_SECOND,
    secMaxRetries: c.SEC_MAX_RETRIES,
    secRetryBaseDelayMs: c.SEC_RETRY_BASE_DELAY_MS,
    failedCompanyRetrySeconds: c.FAILED_COMPANY_RETRY_SECONDS,
    failedCompanyRetryMaxSeconds: c.FAILED_COMPANY_RETRY_MAX_SECONDS,
  };
}
