# Notes

## What we built

A NestJS service that serves 10-K, 10-Q and 8-K filings (and amendments) for AAPL, AMZN,
GOOGL, GS, META and NFLX, filed since 2021-01-01, from memory. On a live run it loaded all
six companies with 31 SEC requests and holds 567 filings.

- **SEC stays out of the request path.** A scheduler loads data at startup and refreshes it
  every 60 seconds (configurable). If SEC is down we keep serving the last good data, and
  every response says how old it is (`meta.dataAsOf`).
- **One gate for SEC data.** A single adapter checks SEC's JSON and rejects a whole file
  rather than drop a bad row: a silently missing 10-K is a wrong answer; a stale company
  with an error in `/health/ready` is an honest one.
- **Polite to SEC.** At most 5 requests per second, retries with backoff only for failures
  that pass, stop on 429/403, failed companies retried every 5 minutes, a required
  `SEC_USER_AGENT`.
- **A contract built to last.** `/v1` paths, problem+json errors with stable types, cursor
  pagination that does not duplicate or skip rows when data refreshes between pages.
- **Facts checked against SEC, not assumed:** `acceptanceDateTime` is real UTC while
  `filingDate` is an Eastern-time business date (they differ on 5,510 rows); SEC's overflow
  file date ranges are wrong in 45 of 48 files; accession prefixes name the filing agent,
  not the company. See [docs/research/sec-findings.md](docs/research/sec-findings.md).
- Tests: 198 unit, 16 HTTP end-to-end (no SEC calls), and a Postman collection (41
  assertions) that passed against live SEC data. `npm audit`: 0 vulnerabilities.

## What we skipped, and why

| Skipped | Why |
|---|---|
| Other forms (DEF 14A, Form 4, 424B2, …), other tickers (GOOG, FB) | Scope decision. Adding them later does not break v1 |
| API keys, per-client rate limits | Belong at an API gateway; requests never reach SEC |
| Database, shared cache, several instances | The brief allows memory; see "next" for when that changes |
| Caching headers, metrics, OpenAPI, CI, hardened Docker image | Hardening milestone; none changes the contract |
| `X-Request-Id` echo, accession numbers without dashes | Cut to fit the time box; both are additions later |
| Seeing SEC corrections to filings older than SEC's one-year `recent` window | Would cost about 25 extra requests per refresh; rare |

## What we would do next

1. **Hardening:** `ETag`/`Cache-Control`, Prometheus metrics with a data-age alert,
   generated OpenAPI, CI running lint, tests, audit and Postman, a smaller non-root image.
2. **Survive restarts while SEC is down:** save the last state to disk and load it at boot.
3. **Move to a separate loader and a shared store** when we need more than one instance,
   when SEC's 10 requests per second (counted across all our machines) becomes tight, or
   past about 300 companies, using SEC's nightly bulk file plus its latest-filings feed.

## Decisions that differ from the original plan

- **TypeScript 6.0.3, not 7.0.2.** TypeScript 7 drops the compiler API that the Nest CLI,
  typescript-eslint and ts-jest depend on.
- **Jest runs with `--experimental-vm-modules`.** NestJS 12 ships as ES modules only. The
  compiled app runs on plain Node 26 without flags.
- **All SEC settings are environment variables** (URLs, rate, retries), at the owner's
  request; the rate cannot be set above 5 per second.
- **An empty SEC `recent` file keeps all older filings** instead of dropping them, and the
  service is only "ready" once every company has actually been tried.
- Where the build changed a decision, the spec and plan in `docs/` were updated in the same
  commit as the code.
