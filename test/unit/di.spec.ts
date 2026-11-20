import { Test } from '@nestjs/testing';
import type { Logger } from 'pino';
import { APP_CONFIG, APP_LOGGER, SEC_CLIENT_DEPS, SEC_SOURCE } from '../../src/common/tokens';
import { AppConfigModule } from '../../src/config/config.module';
import { LoggerModule } from '../../src/common/logger.module';
import { SecModule } from '../../src/sec/sec.module';
import { SecClient, type SecClientDeps, type SecSource } from '../../src/sec/sec-client';
import { loadConfig, type AppConfig } from '../../src/config/config';

const CFG: AppConfig = loadConfig(
  {
    SEC_USER_AGENT: 'Test Company@example.com',
    SEC_BASE_URL: 'http://mock.local/sub',
    LOG_LEVEL: 'warn',
  },
  new Date('2026-11-20T00:00:00Z'),
);

describe('dependency injection wiring', () => {
  it('AppConfigModule builds APP_CONFIG from process.env', async () => {
    const saved = process.env.SEC_USER_AGENT;
    process.env.SEC_USER_AGENT = 'Env Company@example.com';
    try {
      const mod = await Test.createTestingModule({ imports: [AppConfigModule] }).compile();
      expect(mod.get<AppConfig>(APP_CONFIG).secUserAgent).toBe('Env Company@example.com');
    } finally {
      if (saved === undefined) delete process.env.SEC_USER_AGENT;
      else process.env.SEC_USER_AGENT = saved;
    }
  });

  it('LoggerModule provides a logger at the configured LOG_LEVEL', async () => {
    const mod = await Test.createTestingModule({ imports: [AppConfigModule, LoggerModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(CFG)
      .compile();
    expect(mod.get<Logger>(APP_LOGGER).level).toBe('warn');
  });

  it('SecModule provides SEC_SOURCE as a SecClient that uses the injected config and deps', async () => {
    const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(() =>
      Promise.resolve(new Response('{"ok":1}', { status: 200 })),
    );
    const deps: SecClientDeps = {
      fetch: fetchMock,
      sleep: () => Promise.resolve(),
      now: () => 0,
      random: () => 0.5,
    };
    const mod = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SecModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(CFG)
      .overrideProvider(SEC_CLIENT_DEPS)
      .useValue(deps)
      .compile();

    const source = mod.get<SecSource>(SEC_SOURCE);
    expect(source).toBeInstanceOf(SecClient);
    await expect(source.getJson('CIK0000320193.json')).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://mock.local/sub/CIK0000320193.json');
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe(
      'Test Company@example.com',
    );
  });

  it('SecModule default deps use the real fetch, timers, clock and random', async () => {
    const mod = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SecModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(CFG)
      .compile();
    const deps = mod.get<SecClientDeps>(SEC_CLIENT_DEPS);
    expect(typeof deps.fetch).toBe('function');
    expect(Math.abs(deps.now() - Date.now())).toBeLessThan(1000);
    const r = deps.random();
    expect(r >= 0 && r < 1).toBe(true);
    await expect(deps.sleep(1)).resolves.toBeUndefined();
  });
});
