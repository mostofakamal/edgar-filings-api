import { ConfigError, loadConfig } from '../../src/config/config';

const TODAY = new Date('2026-11-20T12:00:00Z');
const UA = 'Test Company@example.com';

function load(env: Record<string, string | undefined>) {
  return loadConfig({ SEC_USER_AGENT: UA, ...env }, TODAY);
}

function errorOf(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env, TODAY);
  } catch (e) {
    if (e instanceof ConfigError) return e;
    throw e;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('uses defaults when only SEC_USER_AGENT is set', () => {
    expect(load({})).toEqual({
      secUserAgent: UA,
      port: 3000,
      refreshIntervalSeconds: 60,
      filingsSince: '2021-01-01',
      secRequestTimeoutMs: 10000,
      logLevel: 'info',
      secBaseUrl: 'https://data.sec.gov/submissions',
      secArchivesBaseUrl: 'https://www.sec.gov/Archives/edgar/data',
      secMaxRequestsPerSecond: 5,
      secMaxRetries: 2,
      secRetryBaseDelayMs: 1000,
      failedCompanyRetrySeconds: 300,
    });
  });

  it('reads every variable when set', () => {
    expect(
      load({
        PORT: '8080',
        REFRESH_INTERVAL_SECONDS: '10',
        FILINGS_SINCE: '2023-06-30',
        SEC_REQUEST_TIMEOUT_MS: '1000',
        LOG_LEVEL: 'debug',
        SEC_BASE_URL: 'http://localhost:4010/submissions/',
        SEC_ARCHIVES_BASE_URL: 'https://archive.example.com/data',
        SEC_MAX_REQUESTS_PER_SECOND: '2',
        SEC_MAX_RETRIES: '0',
        SEC_RETRY_BASE_DELAY_MS: '250',
        FAILED_COMPANY_RETRY_SECONDS: '60',
      }),
    ).toEqual({
      secUserAgent: UA,
      port: 8080,
      refreshIntervalSeconds: 10,
      filingsSince: '2023-06-30',
      secRequestTimeoutMs: 1000,
      logLevel: 'debug',
      secBaseUrl: 'http://localhost:4010/submissions',
      secArchivesBaseUrl: 'https://archive.example.com/data',
      secMaxRequestsPerSecond: 2,
      secMaxRetries: 0,
      secRetryBaseDelayMs: 250,
      failedCompanyRetrySeconds: 60,
    });
  });

  it('rejects missing SEC_USER_AGENT', () => {
    expect(errorOf({}).message).toContain('SEC_USER_AGENT');
    expect(errorOf({ SEC_USER_AGENT: '' }).message).toContain('SEC_USER_AGENT');
  });

  it.each(['bot@x.com', 'Acme Corp'])(
    'rejects SEC_USER_AGENT without a space or an @ (%s)',
    (ua) => {
      expect(errorOf({ SEC_USER_AGENT: ua }).message).toContain('SEC_USER_AGENT');
    },
  );

  it.each(['9', '60.5', 'abc', ''])('rejects REFRESH_INTERVAL_SECONDS %p', (v) => {
    expect(errorOf({ SEC_USER_AGENT: UA, REFRESH_INTERVAL_SECONDS: v }).message).toContain(
      'REFRESH_INTERVAL_SECONDS',
    );
  });

  it.each(['2021-02-30', '2021-1-1', '2026-11-21'])(
    'rejects FILINGS_SINCE that is not a real date or is in the future (%s)',
    (v) => {
      expect(errorOf({ SEC_USER_AGENT: UA, FILINGS_SINCE: v }).message).toContain('FILINGS_SINCE');
    },
  );

  it('accepts FILINGS_SINCE equal to today', () => {
    expect(load({ FILINGS_SINCE: '2026-11-20' }).filingsSince).toBe('2026-11-20');
  });

  it.each([
    ['PORT', '0'],
    ['PORT', '65536'],
    ['SEC_REQUEST_TIMEOUT_MS', '999'],
    ['SEC_REQUEST_TIMEOUT_MS', '60001'],
    ['LOG_LEVEL', 'trace'],
    ['SEC_BASE_URL', 'not a url'],
    ['SEC_BASE_URL', 'ftp://data.sec.gov/submissions'],
    ['SEC_ARCHIVES_BASE_URL', ''],
    ['SEC_MAX_REQUESTS_PER_SECOND', '0'],
    ['SEC_MAX_REQUESTS_PER_SECOND', '6'],
    ['SEC_MAX_RETRIES', '6'],
    ['SEC_MAX_RETRIES', '-1'],
    ['SEC_RETRY_BASE_DELAY_MS', '99'],
    ['SEC_RETRY_BASE_DELAY_MS', '60001'],
    ['FAILED_COMPANY_RETRY_SECONDS', '9'],
  ])('rejects %s=%s', (name, value) => {
    expect(errorOf({ SEC_USER_AGENT: UA, [name]: value }).message).toContain(name);
  });

  it('reports every invalid variable in one error', () => {
    const message = errorOf({ PORT: 'x', LOG_LEVEL: 'loud' }).message;
    expect(message).toContain('SEC_USER_AGENT');
    expect(message).toContain('PORT');
    expect(message).toContain('LOG_LEVEL');
  });
});
