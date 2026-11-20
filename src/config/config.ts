import { z } from 'zod';

export interface AppConfig {
  secUserAgent: string;
  port: number;
  refreshIntervalSeconds: number;
  filingsSince: string;
  secRequestTimeoutMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
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
} as const;

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

function schema(today: string) {
  return z.object({
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
  });
}

/** Reads and checks configuration from environment variables (spec §10). Throws ConfigError listing every problem. */
export function loadConfig(
  env: Record<string, string | undefined>,
  today: Date = new Date(),
): AppConfig {
  const input = {
    SEC_USER_AGENT: env.SEC_USER_AGENT,
    PORT: env.PORT ?? DEFAULTS.PORT,
    REFRESH_INTERVAL_SECONDS: env.REFRESH_INTERVAL_SECONDS ?? DEFAULTS.REFRESH_INTERVAL_SECONDS,
    FILINGS_SINCE: env.FILINGS_SINCE ?? DEFAULTS.FILINGS_SINCE,
    SEC_REQUEST_TIMEOUT_MS: env.SEC_REQUEST_TIMEOUT_MS ?? DEFAULTS.SEC_REQUEST_TIMEOUT_MS,
    LOG_LEVEL: env.LOG_LEVEL ?? DEFAULTS.LOG_LEVEL,
  };
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
  };
}
