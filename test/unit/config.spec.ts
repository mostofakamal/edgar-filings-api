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
      }),
    ).toEqual({
      secUserAgent: UA,
      port: 8080,
      refreshIntervalSeconds: 10,
      filingsSince: '2023-06-30',
      secRequestTimeoutMs: 1000,
      logLevel: 'debug',
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
