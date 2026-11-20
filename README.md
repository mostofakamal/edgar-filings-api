# EDGAR Filings API

A read-only REST API over SEC EDGAR filings for six companies: AAPL, AMZN, GOOGL, GS, META
and NFLX. It serves their 10-K, 10-Q and 8-K filings (and amendments) filed since
2021-01-01, from memory. SEC data is loaded at startup and refreshed in the background;
customer requests never call SEC.

- Design and API contract: [docs/specs/2026-11-20-filings-api-core.md](docs/specs/2026-11-20-filings-api-core.md)
- What we found in SEC's data: [docs/research/sec-findings.md](docs/research/sec-findings.md)
- What we built, skipped and would do next: [NOTES.md](NOTES.md)

```mermaid
flowchart LR
    Customer([Customer]) -->|HTTP /v1| API[Controllers and query service]
    API -->|read| Store[(In-memory store)]
    Scheduler[Refresh scheduler] --> Loader --> Client[SEC client] -->|HTTPS| SEC[(data.sec.gov)]
    Loader -->|swap in new data| Store
```

## Prerequisites

- Node.js 26.13.1 (current LTS) and npm 11
- Docker, to run the container
- Postman CLI, only for the API test collection (`postman --version`)

## Install

```sh
npm ci
```

## Configure

All configuration comes from environment variables. Only `SEC_USER_AGENT` is required. SEC
asks every client to identify itself as `Company Name contact@domain`; requests without it
are refused.

| Variable | Default | Meaning |
|---|---|---|
| `SEC_USER_AGENT` | (required) | Sent to SEC on every request. Must contain a space and an `@` |
| `PORT` | `3000` | HTTP port |
| `REFRESH_INTERVAL_SECONDS` | `60` | Wait between the end of one refresh and the start of the next (at least 10) |
| `FILINGS_SINCE` | `2021-01-01` | Earliest filing date served |
| `SEC_REQUEST_TIMEOUT_MS` | `10000` | Timeout per SEC request |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `SEC_BASE_URL` | `https://data.sec.gov/submissions` | Where submissions files are fetched from |
| `SEC_ARCHIVES_BASE_URL` | `https://www.sec.gov/Archives/edgar/data` | Base of `primaryDocumentUrl` |
| `SEC_MAX_REQUESTS_PER_SECOND` | `5` | 1–5; SEC's own limit is 10 across all machines |
| `SEC_MAX_RETRIES` | `2` | Retries on timeouts, network errors and 5xx |
| `SEC_RETRY_BASE_DELAY_MS` | `1000` | First retry wait; later waits double |
| `FAILED_COMPANY_RETRY_SECONDS` | `300` | Wait before retrying a company that failed to load |

[.env.example](.env.example) lists them all. `.env` files are not read automatically; set
the variables in your shell or pass them to Docker. The service exits with code 1 and a
message if any value is invalid.

## Run locally

```sh
npm run build
SEC_USER_AGENT="Your Company you@your-company.com" npm start
```

The service answers at once. It is ready when every company has been tried once and at
least one has loaded, usually within 10 seconds:

```sh
curl http://localhost:3000/health/ready
```

## Run with Docker

```sh
docker build -t filings-api .
docker run --rm -p 3000:3000 -e SEC_USER_AGENT="Your Company you@your-company.com" filings-api
```

If port 3000 is taken on your machine, map another one, e.g. `-p 3999:3000`, or set
`PORT` when running locally.

## Use the API

```sh
curl http://localhost:3000/v1/companies/AAPL
curl "http://localhost:3000/v1/companies/AAPL/filings?form=10-K,10-Q&limit=2"
curl http://localhost:3000/v1/filings/0000320193-24-000081
```

| Endpoint | Returns |
|---|---|
| `GET /v1/companies/{ticker}` | The company, and how far back its filings go |
| `GET /v1/companies/{ticker}/filings` | Filings newest first. Optional: `form` (comma-separated), `filedFrom`, `filedTo` (`YYYY-MM-DD`, on `filingDate`), `limit` (1–100, default 20), `cursor` (from `page.nextCursor`) |
| `GET /v1/filings/{accessionNumber}` | One filing, e.g. `0000320193-24-000081` |
| `GET /health/live` | 200 while the process runs |
| `GET /health/ready` | 200 when ready, 503 while loading; per-company status and data age |

Every successful response carries `meta.dataAsOf`, the time the data was last refreshed
from SEC. Errors are `application/problem+json`; the error types are listed in spec §8.

## Test

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm audit
```

`npm test` (unit) and `npm run test:e2e` (HTTP, against the real app) use recorded SEC data
in `test/fixtures/` and never call SEC.

### API tests with Postman

The Postman collection checks a running service from the outside, with live SEC data.
Start the service (locally or in Docker), wait until `/health/ready` returns 200, then:

```sh
postman collection run postman/filings-api.postman_collection.json -e postman/local.environment.json
```

For another port, add `--env-var baseUrl=http://localhost:3999`. Both files can also be
imported into the Postman app.

## Project layout

```
src/
  config/      environment variables, checked at startup
  sec/         SEC client (the only code that calls SEC) and adapter (checks SEC's JSON)
  filings/     loader, merge, store, refresh scheduler, query service, controllers
  health/      liveness and readiness
  common/      injection tokens, logger, problem+json errors
test/          unit and e2e tests, recorded SEC fixtures
postman/       API test collection and environment
docs/          research, spec and plan
```
