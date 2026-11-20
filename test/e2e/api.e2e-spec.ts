import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { APP_CONFIG, FILINGS_STORE, SCHEDULER_DEPS, SEC_SOURCE } from '../../src/common/tokens';
import { loadConfig } from '../../src/config/config';
import type { FilingsStore } from '../../src/filings/filings.store';
import { FilingsQueryService } from '../../src/filings/query.service';
import type { SchedulerDeps } from '../../src/filings/refresh.scheduler';
import { SecError, type SecSource } from '../../src/sec/sec-client';
import { FakeSecClient } from '../fakes/fake-sec-client';
import { overflowFixture, submissionsFixture } from '../support/fixtures';

const CFG = loadConfig(
  { SEC_USER_AGENT: 'Test Company@example.com', LOG_LEVEL: 'error' },
  new Date('2026-11-20T00:00:00Z'),
);
/** Real clock, but timers never fire: each test controls when loading happens. */
const NO_TIMERS: SchedulerDeps = {
  now: () => Date.now(),
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};
const SPEC_CURSOR =
  'eyJ2IjoxLCJrIjpbIjIwMjYtMDctMzEiLCIyMDI2LTA3LTMxVDEwOjAxOjAyWiIsIjAwMDAzMjAxOTMtMjYtMDAwMDIwIl0sImYiOnsidCI6IkFBUEwiLCJmb3JtcyI6WyIxMC1LIiwiMTAtUSJdLCJmcm9tIjpudWxsLCJ0byI6bnVsbH19';
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  errors?: { parameter: string; detail: string }[];
}
interface FilingBody {
  accessionNumber: string;
}
interface ListBody {
  data: FilingBody[];
  page: { limit: number; nextCursor: string | null };
  meta: { dataAsOf: string };
}
interface ReadyBody {
  status: string;
  companies: Record<string, { status: string; dataAsOf: string | null; lastError: string | null }>;
}
type Server = Parameters<typeof request>[0];

/** supertest types the body as any; tests name the shape they expect. */
const bodyOf = <T>(res: request.Response): T => res.body as T;
const serverOf = (app: INestApplication): Server => app.getHttpServer() as Server;

function allFixtures(): FakeSecClient {
  const files: Record<string, unknown> = {
    'CIK0000886982-submissions-001.json': overflowFixture('CIK0000886982-submissions-001.json'),
    'CIK0000886982-submissions-022.json': overflowFixture('CIK0000886982-submissions-022.json'),
  };
  for (const cik of [
    '0000320193',
    '0001018724',
    '0001652044',
    '0000886982',
    '0001326801',
    '0001065280',
  ]) {
    files[`CIK${cik}.json`] = submissionsFixture(`CIK${cik}.json`);
  }
  return new FakeSecClient(files);
}

async function start(
  source: SecSource,
  overrides: (b: ReturnType<typeof Test.createTestingModule>) => void = () => undefined,
): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  builder.overrideProvider(APP_CONFIG).useValue(CFG);
  builder.overrideProvider(SEC_SOURCE).useValue(source);
  builder.overrideProvider(SCHEDULER_DEPS).useValue(NO_TIMERS);
  overrides(builder);
  const mod = await builder.compile();
  const app = mod.createNestApplication({ logger: false });
  await app.init();
  return app;
}

async function firstPassDone(app: INestApplication): Promise<void> {
  const store = app.get<FilingsStore>(FILINGS_STORE);
  for (let i = 0; i < 200 && !store.get().firstPassDone; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!store.get().firstPassDone) throw new Error('first pass did not finish');
}

function expectProblem(res: request.Response, status: number, type: string) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  const body = bodyOf<ProblemBody>(res);
  expect(body).toMatchObject({ type, status, instance: expect.any(String) as string });
  expect(typeof body.title).toBe('string');
  expect(typeof body.detail).toBe('string');
}

describe('API with SEC data loaded', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await start(allFixtures());
    await firstPassDone(app);
  });
  afterAll(() => app.close());
  const http = () => request(serverOf(app));

  it('GET /v1/companies/aapl → 200 with the §7.1 shape', async () => {
    const res = await http().get('/v1/companies/aapl').expect(200);
    expect(res.headers['content-type']).toMatch(/^application\/json; charset=utf-8/);
    expect(res.body).toEqual({
      data: {
        ticker: 'AAPL',
        cik: '0000320193',
        name: 'Apple Inc.',
        exchange: 'Nasdaq',
        filingsAvailableFrom: '2021-01-01',
      },
      meta: { dataAsOf: expect.stringMatching(DATE_TIME) as string },
    });
  });

  it('GET /v1/companies/GOOG → 404 company-not-found as problem+json', async () => {
    const res = await http().get('/v1/companies/GOOG');
    expectProblem(res, 404, '/problems/company-not-found');
    expect(bodyOf<ProblemBody>(res).instance).toBe('/v1/companies/GOOG');
    expect(bodyOf<ProblemBody>(res).detail).toContain(
      'Supported tickers: AAPL, AMZN, GOOGL, GS, META, NFLX.',
    );
  });

  it.each(['AAPL.', '%20AAPL', 'A'.repeat(200)])(
    'odd ticker %p → 404 company-not-found',
    async (t) => {
      expectProblem(await http().get(`/v1/companies/${t}`), 404, '/problems/company-not-found');
    },
  );

  it('GET /v1/companies/AAPL/filings?form=10-K,10-Q&limit=2 → the §7.2 page and cursor', async () => {
    const res = await http().get('/v1/companies/AAPL/filings?form=10-K,10-Q&limit=2').expect(200);
    expect(bodyOf<ListBody>(res).data.map((f) => f.accessionNumber)).toEqual([
      '0000320193-26-000026',
      '0000320193-26-000020',
    ]);
    expect(bodyOf<ListBody>(res).page).toEqual({ limit: 2, nextCursor: SPEC_CURSOR });
    expect(bodyOf<ListBody>(res).meta.dataAsOf).toMatch(DATE_TIME);
  });

  it('?form=4 → 400 invalid-parameter', async () => {
    const res = await http().get('/v1/companies/AAPL/filings?form=4');
    expectProblem(res, 400, '/problems/invalid-parameter');
    expect(bodyOf<ProblemBody>(res).errors![0]!.parameter).toBe('form');
  });

  it('a repeated query parameter → 400 invalid-parameter', async () => {
    const res = await http().get('/v1/companies/AAPL/filings?form=10-K&form=10-Q');
    expectProblem(res, 400, '/problems/invalid-parameter');
  });

  it('GET /v1/filings/0000320193-24-000081 → 200 equal to the §7.3 example', async () => {
    const res = await http().get('/v1/filings/0000320193-24-000081').expect(200);
    expect(bodyOf<{ data: unknown }>(res).data).toEqual({
      accessionNumber: '0000320193-24-000081',
      ticker: 'AAPL',
      cik: '0000320193',
      form: '10-Q',
      filingDate: '2024-08-02',
      reportDate: '2024-06-29',
      acceptanceDateTime: '2024-08-01T22:03:34Z',
      primaryDocumentUrl:
        'https://www.sec.gov/Archives/edgar/data/320193/000032019324000081/aapl-20240629.htm',
    });
    expect(bodyOf<ListBody>(res).meta.dataAsOf).toMatch(DATE_TIME);
  });

  it('GET /v1/filings/123 → 400 invalid-parameter', async () => {
    expectProblem(await http().get('/v1/filings/123'), 400, '/problems/invalid-parameter');
  });

  it('unknown accession when all companies loaded → 404 filing-not-found', async () => {
    expectProblem(
      await http().get('/v1/filings/0000320193-24-999999'),
      404,
      '/problems/filing-not-found',
    );
  });

  it('GET /v1/unknown → 404 not-found as problem+json', async () => {
    const res = await http().get('/v1/unknown');
    expectProblem(res, 404, '/problems/not-found');
    expect(bodyOf<ProblemBody>(res).instance).toBe('/v1/unknown');
  });

  it('/health/ready → 200 ready with all six companies loaded', async () => {
    const res = await http().get('/health/ready').expect(200);
    expect(bodyOf<ReadyBody>(res).status).toBe('ready');
    expect(Object.keys(bodyOf<ReadyBody>(res).companies)).toEqual([
      'AAPL',
      'AMZN',
      'GOOGL',
      'GS',
      'META',
      'NFLX',
    ]);
    expect(bodyOf<ReadyBody>(res).companies.AAPL).toEqual({
      status: 'loaded',
      dataAsOf: expect.stringMatching(DATE_TIME) as string,
      lastError: null,
    });
  });
});

describe('API when an internal error happens', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await start(allFixtures(), (b) => {
      b.overrideProvider(FilingsQueryService).useValue({
        getCompany: () => {
          throw new Error('boom: secret internals');
        },
      });
    });
  });
  afterAll(() => app.close());

  it('→ 500 internal-error with no stack trace or message in the body', async () => {
    const res = await request(serverOf(app)).get('/v1/companies/AAPL');
    expectProblem(res, 500, '/problems/internal-error');
    expect(JSON.stringify(bodyOf<unknown>(res))).not.toContain('boom');
    expect(JSON.stringify(bodyOf<unknown>(res))).not.toContain('at ');
  });
});

describe('API when SEC is unreachable', () => {
  let app: INestApplication;
  let release: () => void = () => undefined;
  beforeAll(async () => {
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const unreachable: SecSource = {
      getJson: async () => {
        await gate;
        throw new SecError('network', 'fetch failed');
      },
    };
    app = await start(unreachable);
  });
  afterAll(() => app.close());
  const http = () => request(serverOf(app));

  it('before the first pass: live 200, ready 503 loading, data 503 with Retry-After', async () => {
    await http().get('/health/live').expect(200);
    const ready = await http().get('/health/ready').expect(503);
    expect(bodyOf<ReadyBody>(ready).status).toBe('loading');
    const res = await http().get('/v1/companies/AAPL');
    expectProblem(res, 503, '/problems/data-unavailable');
    expect(res.headers['retry-after']).toBe('60');
  });

  it('after the first pass with nothing loaded: still not ready, companies failed', async () => {
    release();
    await firstPassDone(app);
    await http().get('/health/live').expect(200);
    const ready = await http().get('/health/ready').expect(503);
    expect(bodyOf<ReadyBody>(ready).status).toBe('loading');
    expect(bodyOf<ReadyBody>(ready).companies.AAPL).toMatchObject({
      status: 'failed',
      lastError: 'fetch failed',
    });
    expectProblem(
      await http().get('/v1/filings/0000320193-24-000081'),
      503,
      '/problems/data-unavailable',
    );
  });
});
