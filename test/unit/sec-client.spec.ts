import { SecClient, SecError, SecClientDeps } from '../../src/sec/sec-client';

const CFG = {
  secUserAgent: 'Test Company@example.com',
  secRequestTimeoutMs: 10000,
  secBaseUrl: 'https://data.sec.gov/submissions',
  secMaxRequestsPerSecond: 5,
  secMaxRetries: 2,
  secRetryBaseDelayMs: 1000,
};
const FILE = 'CIK0000320193.json';

/** Fake clock: sleep() records the wait and moves time forward. */
function harness(responses: Array<Response | Error>, random = 0.5, cfg: Partial<typeof CFG> = {}) {
  let t = 0;
  const sleeps: number[] = [];
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
  for (const r of responses) {
    // instanceof Response, not Error: a DOMException from another realm fails `instanceof Error`.
    if (r instanceof Response) fetchMock.mockResolvedValueOnce(r);
    else fetchMock.mockRejectedValueOnce(r);
  }
  const deps: SecClientDeps = {
    fetch: fetchMock,
    sleep: (ms) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
    now: () => t,
    random: () => random,
  };
  const warn = jest.fn<void, [object, string]>();
  const client = new SecClient({ ...CFG, ...cfg }, deps, { warn });
  return {
    client,
    fetchMock,
    sleeps,
    warn,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (status: number, headers: Record<string, string> = {}) =>
  new Response(
    '<html><title>SEC.gov | Your Request Originates from an Undeclared Automated Tool</title></html>',
    {
      status,
      headers: { 'content-type': 'text/html', ...headers },
    },
  );
const timeoutError = () =>
  new DOMException('The operation was aborted due to timeout', 'TimeoutError');
const networkError = () => new TypeError('fetch failed');

async function errorOf(p: Promise<unknown>): Promise<SecError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof SecError) return e;
    throw e;
  }
  throw new Error('expected a SecError');
}

describe('SecClient', () => {
  it('sends exactly the SEC headers to the submissions URL', async () => {
    const h = harness([json({ ok: 1 })]);
    await h.client.getJson(FILE);
    const [url, init] = h.fetchMock.mock.calls[0]!;
    expect(url).toBe('https://data.sec.gov/submissions/CIK0000320193.json');
    expect(init?.headers).toEqual({
      'User-Agent': 'Test Company@example.com',
      'Accept-Encoding': 'gzip, deflate',
      Accept: 'application/json',
    });
  });

  it('returns parsed JSON on 200', async () => {
    const h = harness([json({ cik: '0000320193' })]);
    await expect(h.client.getJson(FILE)).resolves.toEqual({ cik: '0000320193' });
  });

  it('accepts overflow file names', async () => {
    const h = harness([json({})]);
    await h.client.getJson('CIK0000886982-submissions-001.json');
    expect(h.fetchMock.mock.calls[0]![0]).toBe(
      'https://data.sec.gov/submissions/CIK0000886982-submissions-001.json',
    );
  });

  it('maps 429 to rate_limited with retryAfterSeconds from Retry-After, without retry', async () => {
    const h = harness([html(429, { 'retry-after': '30' })]);
    const e = await errorOf(h.client.getJson(FILE));
    expect(e).toMatchObject({ kind: 'rate_limited', status: 429, retryAfterSeconds: 30 });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 429 without Retry-After to rate_limited with no retryAfterSeconds', async () => {
    const h = harness([html(429)]);
    const e = await errorOf(h.client.getJson(FILE));
    expect(e.kind).toBe('rate_limited');
    expect(e.retryAfterSeconds).toBeUndefined();
  });

  it('maps a 403 HTML page to forbidden, without retry', async () => {
    const h = harness([html(403)]);
    const e = await errorOf(h.client.getJson(FILE));
    expect(e).toMatchObject({ kind: 'forbidden', status: 403 });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 404 to http_error with status 404, without retry', async () => {
    const h = harness([html(404)]);
    const e = await errorOf(h.client.getJson(FILE));
    expect(e).toMatchObject({ kind: 'http_error', status: 404 });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 200 with an HTML body to not_json, without retry', async () => {
    const h = harness([html(200)]);
    const e = await errorOf(h.client.getJson(FILE));
    expect(e.kind).toBe('not_json');
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 503 twice then succeeds, waiting 1 s then 2 s', async () => {
    const h = harness([html(503), html(503), json({ ok: 1 })]);
    await expect(h.client.getJson(FILE)).resolves.toEqual({ ok: 1 });
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    expect(h.sleeps).toEqual([1000, 2000]);
    expect(h.warn).toHaveBeenCalledTimes(2);
    expect(h.warn.mock.calls[0]![0]).toEqual({ fileName: FILE, attempt: 1, kind: 'http_error' });
  });

  it.each([
    [0, 750, 1500],
    [0.999999, 1250, 2500],
  ])('keeps retry waits within ±25%% (random=%p)', async (random, first, second) => {
    const h = harness([html(500), html(502), json({})], random);
    await h.client.getJson(FILE);
    expect(h.sleeps[0]).toBeCloseTo(first, 0);
    expect(h.sleeps[1]).toBeCloseTo(second, 0);
  });

  it('retries timeout and network errors and gives up after 3 attempts with the last kind', async () => {
    const h = harness([timeoutError(), networkError(), timeoutError()]);
    const e = await errorOf(h.client.getJson(FILE));
    expect(e.kind).toBe('timeout');
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
  });

  it('maps a network failure to network', async () => {
    const h = harness([networkError(), networkError(), networkError()]);
    const e = await errorOf(h.client.getJson(FILE));
    expect(e.kind).toBe('network');
  });

  it('passes an abort signal so a request stops after secRequestTimeoutMs', async () => {
    const h = harness([json({})]);
    await h.client.getJson(FILE);
    const init = h.fetchMock.mock.calls[0]![1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('spaces request starts at least 200 ms apart', async () => {
    const h = harness([json({}), json({})]);
    await h.client.getJson(FILE);
    h.advance(50);
    await h.client.getJson(FILE);
    expect(h.sleeps).toEqual([150]);
  });

  it('does not wait when the previous request started long enough ago', async () => {
    const h = harness([json({}), json({})]);
    await h.client.getJson(FILE);
    h.advance(500);
    await h.client.getJson(FILE);
    expect(h.sleeps).toEqual([]);
  });

  it.each(['../x.json', 'https://evil/x', 'CIK320193.json', 'CIK0000320193-submissions-1.json'])(
    'rejects file name %p without calling fetch',
    async (name) => {
      const h = harness([json({})]);
      await expect(h.client.getJson(name)).rejects.toThrow('Invalid SEC file name');
      expect(h.fetchMock).not.toHaveBeenCalled();
    },
  );
  describe('settings come from config', () => {
    it('builds URLs from secBaseUrl', async () => {
      const h = harness([json({})], 0.5, { secBaseUrl: 'http://localhost:4010/submissions' });
      await h.client.getJson(FILE);
      expect(h.fetchMock.mock.calls[0]![0]).toBe(
        'http://localhost:4010/submissions/CIK0000320193.json',
      );
    });

    it('spaces requests by secMaxRequestsPerSecond (2 per second = 500 ms)', async () => {
      const h = harness([json({}), json({})], 0.5, { secMaxRequestsPerSecond: 2 });
      await h.client.getJson(FILE);
      h.advance(100);
      await h.client.getJson(FILE);
      expect(h.sleeps).toEqual([400]);
    });

    it('retries secMaxRetries times, doubling secRetryBaseDelayMs', async () => {
      const h = harness([html(503), html(503), html(503), html(503)], 0.5, {
        secMaxRetries: 3,
        secRetryBaseDelayMs: 250, // above the 200 ms spacing, so only retry waits are recorded
      });
      const e = await errorOf(h.client.getJson(FILE));
      expect(e.kind).toBe('http_error');
      expect(h.fetchMock).toHaveBeenCalledTimes(4);
      expect(h.sleeps).toEqual([250, 500, 1000]);
    });

    it('does not retry when secMaxRetries is 0', async () => {
      const h = harness([html(503)], 0.5, { secMaxRetries: 0 });
      await errorOf(h.client.getJson(FILE));
      expect(h.fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
