# Notes

## What we built

A NestJS service over SEC EDGAR for AAPL, AMZN, GOOGL, GS, META and NFLX: look up a company,
list its 10-K, 10-Q and 8-K filings (and amendments) since 2021-01-01 newest first with form
and date filters and pagination, and fetch one filing by accession number.

| Decision | Why |
|---|---|
| Load at startup, refresh every 60 s, serve from memory | Requests never wait on SEC or depend on it being up; SEC load is fixed, not driven by our traffic |
| One adapter checks SEC's JSON and rejects a whole bad file | A silently missing 10-K is a wrong answer; a stale company with a visible error is an honest one |
| Keep the last good data when SEC fails, show its age in `meta.dataAsOf` | Clients decide what age is acceptable; we never hide staleness |
| At most 5 SEC requests/s, retries only for passing failures, stop on 429/403 | SEC allows 10/s across all our machines and blocks IPs that exceed it |
| A failing company backs off exponentially (5 min doubling to 1 h); 503s say when to retry | A broken company must not re-download its files every minute, and clients should not poll in vain |
| Cursor pagination on SEC's own sort order | Page numbers shift when new filings arrive every minute; a position does not |
| Filter on `filingDate`, also return `acceptanceDateTime` in UTC | `filingDate` is SEC's official Eastern-time date; the two differ on 5,510 rows |
| Core forms only, primary tickers only | Owner scope; Form 4 and GS's prospectuses are most of SEC's rows but not what was asked for |
| `/v1` paths, RFC 9457 problem+json errors | Both are breaking to add later; cheap now |
| Ready once every company was tried and one loaded | One bad company file should not take the other five offline |
| Dependency injection, interfaces for SEC access and the store | Tests replace SEC; a shared store can replace memory without touching the API |
| All SEC settings are environment variables, rate capped at 5/s | Owner rule: no hardcoded config; the cap stops a bad value from breaking SEC's limit |

## What we skipped, and why

| Skipped | Why it was the right call for 2 hours |
|---|---|
| API keys, per-client rate limits | Belong at the API gateway; they protect nothing here, since requests never reach SEC |
| Caching headers, metrics, OpenAPI, CI, hardened Docker image | None changes the contract, so they can follow without breaking clients |
| Database, several instances | The brief allows memory; one instance meets the need, and the store interface keeps the door open |
| Other forms and tickers (DEF 14A, Form 4, GOOG, FB) | Adding them later is not a breaking change; filtering them out kept the data small (567 rows) |
| `X-Request-Id` echo, accession numbers without dashes | Small additions, cut to protect the parts that prevent wrong answers |
| Seeing SEC corrections to filings older than SEC's one-year `recent` window | About 25 extra requests per refresh for a rare event |
| A latency target | Owner decision; measured baselines are below instead |

## What we would do next, in priority order

1. **Remaining review findings:** non-ASCII tickers (`gſ` resolves to GS), a size cap on SEC
   responses, startup 503s logged with stack traces, cursor filter check order.
2. **Hardening:** a metric and alert on data age, `ETag`/`Cache-Control`, generated OpenAPI,
   CI running lint, tests, audit and Postman, a smaller non-root Docker image.
3. **Survive a restart while SEC is down:** save the last state to disk, load it at boot.
4. **Separate loader and shared store** when we need more than one instance, or past about
   300 companies (SEC's limit allows 600 requests a minute), using SEC's nightly bulk file.

## Numbers we measured (live SEC, 2026-11-20, one instance)

| What | Result |
|---|---|
| Startup | ready after 7.2 s; 31 SEC requests (23 for GS) |
| Data held | 567 filings, 166 KB as JSON |
| Process memory | 158 MB RSS when ready, 207–222 MB under load and through refreshes |
| List page latency, one client | p50 0.2 ms, p99 0.7 ms |
| List page latency, 50 concurrent clients | p50 3.0 ms, p99 7.4 ms, about 15,000 requests/s |
| Refresh | 6 SEC requests, 1.3–2.6 s, slows requests for at most 27 ms |
| Tests | 211 unit and 16 end-to-end (no SEC calls), Postman 41/41 against live SEC; `npm audit` 0 |

Details: [spec §12](docs/specs/2026-11-20-filings-api-core.md#12-scaling). Where the build
departed from the plan (TypeScript 6.0.3 because TypeScript 7 drops the compiler API our
tools need; Jest runs with `--experimental-vm-modules` because NestJS 12 ships only as ES
modules), the plan's toolchain notes record why.
