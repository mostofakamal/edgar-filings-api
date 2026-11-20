# EDGAR Filings API — Core Milestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** executed on `feat/core-milestone` (Tasks 1–9 plus the final-review fixes). Where the build departed from this plan, the plan text and the spec were updated in the same commit.

**Goal:** Build the core milestone of the read-only EDGAR Filings API exactly as the spec describes, in about 2 hours.

**Architecture:** One NestJS process. A refresh scheduler drives a loader that fetches SEC files through one SEC client, checks them through one adapter, and swaps each company into an in-memory store. Controllers only read the store through a pure query service; nothing on the request path can reach SEC.

**Tech Stack:** Node 26.13.1 (LTS), TypeScript 6.0.3, NestJS 12.6.0 (Express), zod 4.6.7, nestjs-pino 5.3.2 / pino 10.4.0 / pino-http 11.0.0, Jest 30.5.2 + ts-jest 29.4.15, supertest 7.3.2, ESLint 10.15.0 + typescript-eslint 8.73.0, Prettier 3.10.1, Postman CLI 1.73.0, Docker image `node:26.13.1-alpine`.

**Spec:** [docs/specs/2026-11-20-filings-api-core.md](../specs/2026-11-20-filings-api-core.md). Section numbers below (§n) refer to it. When this plan and the spec disagree, the spec wins; record the disagreement as a deviation.

## Global Constraints

- Requests never call SEC; only `SecClient` makes HTTP calls to SEC, only `sec-adapter.ts` knows SEC's JSON shape (§3, §5).
- Core forms are exactly `10-K, 10-K/A, 10-Q, 10-Q/A, 8-K, 8-K/A` (§2).
- SEC headers exactly: `User-Agent: <SEC_USER_AGENT>`, `Accept-Encoding: gzip, deflate`, `Accept: application/json` (§3).
- At most `SEC_MAX_REQUESTS_PER_SECOND` (default and maximum 5) SEC requests per second: request starts at least `ceil(1000 / rate)` ms apart, retries included (§3, §9.3).
- Retries: `timeout`, `network`, 5xx only; up to `SEC_MAX_RETRIES` (default 2) more attempts; waits `SEC_RETRY_BASE_DELAY_MS × 2^(n-1)` (default 1000, 2000 ms), each × a random factor in [0.75, 1.25] (§9.3).
- No operational value is hardcoded: SEC URLs, rate, retries, retry delays and the failed-company retry interval come from `AppConfig` (§10). Owner decision, 2026-11-20.
- Config from env only; `SEC_USER_AGENT` required, no default (§10).
- Exact dependency versions (`--save-exact`); `overrides`: `glob@14.0.6`, `minimatch@11.0.9` (needed for `npm audit` = 0, see toolchain note below).
- Every error is `application/problem+json` with `type`, `title`, `status`, `detail`, `instance` (§8).
- Test first: write the test, see it fail for the expected reason, then write code (CLAUDE.md).
- Done per task: `npm run lint && npm run typecheck && npm test` pass; `npm audit` reports 0.
- No test calls SEC. Tests use `test/fixtures/` (real SEC rows recorded 2026-11-20) and a fake client.
- Commit after every task, only after the owner approves; no AI attribution in commits.

### Toolchain note (deviation from CLAUDE.md, needs owner approval)

CLAUDE.md asks for the latest stable TypeScript, which is 7.0.2 (published 2026-07-08). We use **6.0.3** instead, because:

- `typescript@7.0.2` no longer exports the classic compiler API (`exports` has only `./unstable/*`),
- `@nestjs/cli@12.0.15` itself depends on `typescript ~6.0.2`,
- `typescript-eslint@8.73.0` requires `typescript >=4.8.4 <6.1.0`, and `ts-jest@29.4.15` requires `<7`.

We also skip `@nestjs/cli`: `tsc` builds the app, so it is one dependency fewer. (npm still flags one install script, `@parcel/watcher`, which comes from Jest's `jest-haste-map`, not the Nest CLI. npm does not run it; Jest works without it, it is only used for watch mode.) Trial install with the versions above plus the two overrides: `npm audit` → 0 vulnerabilities; Jest with coverage and `tsc --noEmit` both run.

### NestJS 12 is ES modules only

`@nestjs/common`, `@nestjs/core`, `@nestjs/testing` and `@nestjs/platform-express` 12.6.0 have `"type": "module"`. Our code compiles to CommonJS, which Node 26 loads fine: the compiled app resolved Nest providers with plain `node`, no flags. Jest's module loader needs Node's `--experimental-vm-modules` to do the same, so the `test` and `test:e2e` scripts run Jest with that flag (and `--no-warnings=ExperimentalWarning`). Production does not use the flag.

## Design Principles

Owner instruction (2026-11-20): follow design principles and use dependency injection.

- **Dependency injection through Nest.** Every class with dependencies is `@Injectable()` and receives them through its constructor with `@Inject(TOKEN)`. Tokens live in `src/common/tokens.ts`: `APP_CONFIG`, `APP_LOGGER`, `SEC_CLIENT_DEPS`, `SEC_SOURCE`, `FILINGS_STORE`, `SCHEDULER_DEPS`. No class reads `process.env`, creates a logger, or calls `Date.now`/`setTimeout`/`fetch` directly; they come from providers.
- **Depend on abstractions (dependency inversion).** Consumers depend on interfaces bound to tokens, not on concrete classes: the loader on `SecSource` (`SEC_SOURCE`), the scheduler and query service on `FilingsStore` (`FILINGS_STORE`). Replacing the in-memory store with a shared one later is one provider change.
- **One reason to change per unit (single responsibility).** Client = HTTP to SEC; adapter = SEC's JSON shape; loader = what to fetch and merge; store = state; scheduler = when; query service = filter/sort/page; controllers = HTTP in/out.
- **Functional core.** Logic with no dependencies stays as pure functions (adapter, merge, cursor, query helpers, `toFiling`). They are tested directly and need no injection; injectable classes wrap them where Nest needs a provider.
- **Tests replace dependencies the Nest way**: unit tests construct classes with fakes; module and E2E tests use `Test.createTestingModule(...).overrideProvider(TOKEN)`.
- **Modules:** `AppConfigModule` (global, `APP_CONFIG`), `LoggerModule` (global, `APP_LOGGER`), `SecModule` (exports `SEC_SOURCE`), `FilingsModule` (store, loader, scheduler, query service, controllers), `HealthModule`, `AppModule` imports them all.

## File Structure

```
package.json, package-lock.json, tsconfig.json, tsconfig.build.json,
jest.config.js, eslint.config.mjs, .prettierrc, .gitignore, .dockerignore,
.env.example, Dockerfile, README.md, NOTES.md
src/
  main.ts                      bootstrap: config, logger, scheduler start, listen
  app.module.ts                wires everything
  companies.ts                 COMPANIES, Ticker, CORE_FORMS
  config/config.ts             loadConfig(), AppConfig, ConfigError, isRealDate()
  config/config.module.ts      AppConfigModule (APP_CONFIG)
  common/tokens.ts             injection tokens
  common/logger.ts             AppLogger interface
  common/logger.module.ts      LoggerModule (APP_LOGGER, pino)
  sec/sec.module.ts            SecModule (SEC_CLIENT_DEPS, SecClient, SEC_SOURCE)
  filings/filings.module.ts    FilingsModule
  health/health.module.ts      HealthModule
  sec/sec-client.ts            SecClient, SecError
  sec/sec-adapter.ts           parseSubmissions(), parseOverflow(), SecDataError
  filings/filing.ts            Filing, Company, toFiling(), compareFilings()
  filings/merge.ts             mergeRefresh()
  filings/loader.ts            Loader
  filings/filings.store.ts     FilingsStore, InMemoryFilingsStore, CompanyState, isReady()
  filings/refresh.scheduler.ts RefreshScheduler
  filings/cursor.ts            encodeCursor(), decodeCursor()
  filings/query.ts             parseListQuery(), listFilings(), findFiling() (pure)
  filings/query.service.ts     FilingsQueryService (check order, wraps query.ts)
  filings/companies.controller.ts, filings/filings.controller.ts
  health/health.controller.ts
  common/problem.ts            Problem, problem factories
  common/problem.filter.ts     ProblemFilter
test/
  fixtures/                    trimmed real SEC files (see Task 3)
  fakes/fake-sec-client.ts     serves fixtures, throws on anything else
  unit/*.spec.ts
  e2e/api.e2e-spec.ts
postman/
  filings-api.postman_collection.json   v2.1 JSON collection
  local.environment.json                local environment
```

## Review Focus

Inputs the spec implies but no task's main tests exercise; each line has a test in the owning task.

1. Odd tickers in the path (`AAPL.`, `%20AAPL`, 200-character string): 404 `company-not-found`, never 500. → Task 8.
2. `limit` values `0`, `101`, `10.5`, `abc`, empty `limit=`: 400 `invalid-parameter`. → Task 6.
3. Impossible dates (`2025-02-30`, `2025-13-01`, `20250101`): 400 `invalid-parameter`. → Task 6.
4. SEC answers 200 with an HTML maintenance page: `not_json`, company `stale`/`failed`, process keeps running. → Task 2 (client) and Task 5 (scheduler).
5. SEC unreachable from the start: process stays up, `/health/live` 200, `/health/ready` 503, data endpoints 503 with `Retry-After`. → Task 8.

---

### Task 1: Project scaffold and config

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `jest.config.js`, `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `.env.example`, `src/companies.ts`, `src/config/config.ts`
- Test: `test/unit/config.spec.ts`

**Interfaces:**
- Produces:
  - `COMPANIES: readonly { ticker: Ticker; cik: string }[]` in alphabetical order: AAPL 0000320193, AMZN 0001018724, GOOGL 0001652044, GS 0000886982, META 0001326801, NFLX 0001065280.
  - `type Ticker = 'AAPL' | 'AMZN' | 'GOOGL' | 'GS' | 'META' | 'NFLX'`
  - `CORE_FORMS: readonly string[]` = the six core forms, in the order of the Global Constraints.
  - `interface AppConfig { secUserAgent: string; port: number; refreshIntervalSeconds: number; filingsSince: string; secRequestTimeoutMs: number; logLevel: 'debug' | 'info' | 'warn' | 'error' }`
  - `loadConfig(env: Record<string, string | undefined>, today?: Date): AppConfig`. Throws `ConfigError` whose `message` lists every invalid variable.
- npm scripts: `build` (`tsc -p tsconfig.build.json`), `start` (`node dist/main.js`), `test` (`jest test/unit`), `test:e2e` (`jest test/e2e`), `lint` (`eslint .`), `typecheck` (`tsc --noEmit`), `format` (`prettier --write .`).

- [ ] **Step 1: Install exact versions.** Runtime: `@nestjs/core @nestjs/common @nestjs/platform-express` 12.6.0, `reflect-metadata@0.2.2`, `rxjs@7.8.2`, `zod@4.6.7`, `nestjs-pino@5.3.2`, `pino@10.4.0`, `pino-http@11.0.0`. Dev: `typescript@6.0.3`, `@nestjs/testing@12.6.0`, `jest@30.5.2`, `ts-jest@29.4.15`, `@types/jest@30.0.0`, `supertest@7.3.2`, `@types/supertest@7.2.1`, `@types/node@26.6.6`, `eslint@10.15.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.73.0`, `prettier@3.10.1`, `eslint-config-prettier@10.1.8`. Add `overrides` and `"engines": { "node": ">=26.13.1 <27" }`. tsconfig: `strict`, `experimentalDecorators`, `emitDecoratorMetadata`, `target ES2023`, `module commonjs`.
- [ ] **Step 2: Write failing tests** in `test/unit/config.spec.ts`:
  - `uses defaults when only SEC_USER_AGENT is set` → `{ port: 3000, refreshIntervalSeconds: 60, filingsSince: '2021-01-01', secRequestTimeoutMs: 10000, logLevel: 'info' }`
  - `rejects missing SEC_USER_AGENT` → throws `ConfigError`, message contains `SEC_USER_AGENT`
  - `rejects SEC_USER_AGENT without a space or an @` (`'bot@x.com'`, `'Acme Corp'`)
  - `rejects REFRESH_INTERVAL_SECONDS below 10` (`'9'`), and non-integers (`'60.5'`, `'abc'`)
  - `rejects FILINGS_SINCE that is not a real date or is in the future` (`'2021-02-30'`, `'2021-1-1'`, tomorrow relative to `today`)
  - `rejects PORT outside 1–65535`, `SEC_REQUEST_TIMEOUT_MS outside 1000–60000`, `LOG_LEVEL 'trace'`
  - `reports every invalid variable in one error` (two bad vars → both names in message)
- [ ] **Step 3: Run** `npx jest test/unit/config.spec.ts` → FAIL: cannot find module `../../src/config/config`.
- [ ] **Step 4: Implement** `loadConfig` with a zod schema; a real-date check is "parses as UTC and formats back to the same string".
- [ ] **Step 5: Run** `npm run lint && npm run typecheck && npm test && npm audit` → all pass, `found 0 vulnerabilities`.
- [ ] **Step 6: Ask owner, then commit** `chore: scaffold project and add validated env config`.

### Task 2: SEC client

**Files:**
- Create: `src/sec/sec-client.ts`
- Test: `test/unit/sec-client.spec.ts`

**Interfaces:**
- Consumes: `AppConfig` (Task 1).
- Produces:
  - `type SecErrorKind = 'timeout' | 'network' | 'rate_limited' | 'forbidden' | 'http_error' | 'not_json'`
  - `class SecError extends Error { kind: SecErrorKind; status?: number; retryAfterSeconds?: number }`
  - `interface SecClientDeps { fetch: typeof fetch; sleep(ms: number): Promise<void>; now(): number; random(): number }`
  - `interface SecSource { getJson(fileName: string): Promise<unknown> }` (what consumers depend on, token `SEC_SOURCE`)
  - `@Injectable() class SecClient implements SecSource { constructor(@Inject(APP_CONFIG) cfg: SecClientConfig, @Inject(SEC_CLIENT_DEPS) deps: SecClientDeps, @Inject(APP_LOGGER) log: Pick<AppLogger, 'warn'>); getJson(fileName: string): Promise<unknown> }`; `SecModule` binds `SEC_SOURCE` to it (test: `test/unit/di.spec.ts`)
  - `fileName` must match `^CIK\d{10}(-submissions-\d{3})?\.json$`; otherwise `getJson` throws a plain `Error` (programming bug) without a request. URL is `https://data.sec.gov/submissions/${fileName}`.

- [ ] **Step 1: Write failing tests** with a stub `fetch` and fake `sleep/now/random`:
  - `sends exactly the SEC headers` (User-Agent, `Accept-Encoding: gzip, deflate`, `Accept: application/json`)
  - `returns parsed JSON on 200`
  - `maps 429 to rate_limited with retryAfterSeconds from Retry-After` (`'30'` → 30) and does not retry (fetch called once)
  - `maps 403 HTML page to forbidden` without retry
  - `maps 404 to http_error status 404` without retry
  - `maps 200 with HTML body to not_json` without retry
  - `retries 503 twice then succeeds` → fetch called 3 times; `sleep` called with values in [750, 1250] then [1500, 2500]
  - `retries timeout and network errors, gives up after 3 attempts` → throws `SecError` of the last kind
  - `aborts a request after secRequestTimeoutMs` → `timeout` (use `AbortSignal.timeout` or a timer; assert the signal is passed)
  - `spaces request starts at least 200 ms apart` → two calls with `now()` 50 ms apart cause `sleep(150)`
  - `rejects file names outside the allowed pattern` (`'../x.json'`, `'https://evil/x'`) without calling fetch
- [ ] **Step 2: Run** `npx jest test/unit/sec-client.spec.ts` → FAIL: module not found.
- [ ] **Step 3: Implement.** Retry loop over attempts 1–3; wait `[1000, 2000][attempt-1] * (0.75 + random() * 0.5)`; spacing waits until `lastStart + 200`. Log each retry at warn: `{ fileName, attempt, kind }`.
- [ ] **Step 4: Run** the file's tests → PASS; then the full done check.
- [ ] **Step 5: Ask owner, then commit** `feat(sec): add SEC client with headers, spacing, timeout and retries`.

### Task 3: SEC adapter and fixtures

**Files:**
- Create: `src/sec/sec-adapter.ts`, `src/filings/filing.ts`, `test/fixtures/` (see Step 1)
- Test: `test/unit/sec-adapter.spec.ts`, `test/unit/filing.spec.ts`

**Interfaces:**
- Consumes: `CORE_FORMS`, `COMPANIES` (Task 1).
- Produces:
  - `interface SecFilingRow { accessionNumber: string; form: string; filingDate: string; reportDate: string | null; acceptanceDateTime: string /* YYYY-MM-DDTHH:mm:ssZ */; primaryDocument: string | null }`
  - `interface ParsedSubmissions { cik: string; name: string; tickers: string[]; exchanges: (string | null)[]; rows: SecFilingRow[] /* core forms only */; oldestFilingDate: string | null /* over ALL rows */; overflowFiles: string[] /* in listed order */ }`
  - `interface ParsedOverflow { rows: SecFilingRow[]; oldestFilingDate: string | null }`
  - `class SecDataError extends Error`
  - `parseSubmissions(raw: unknown, expectedCik: string): ParsedSubmissions`
  - `parseOverflow(raw: unknown): ParsedOverflow`
  - `interface Filing { accessionNumber; ticker: Ticker; cik; form; filingDate; reportDate: string | null; acceptanceDateTime; primaryDocumentUrl: string | null }` (all strings unless noted)
  - `interface Company { ticker: Ticker; cik: string; name: string; exchange: string | null; filingsAvailableFrom: string }`
  - `toFiling(row: SecFilingRow, ticker: Ticker, cik: string, archivesBaseUrl: string): Filing` — `archivesBaseUrl` is `AppConfig.secArchivesBaseUrl`
  - `compareFilings(a: Filing, b: Filing): number` — negative when `a` is newer (§7.2 order).
  - `oldestFilingDate` is computed over all rows, not just core rows: the overflow stop rule and the merge's `R` need it.

- [ ] **Step 1: Create fixtures** by trimming the recorded 2026-11-20 files (kept outside the repo) to real rows:
  - `CIK0000320193.json`: AAPL with `0000320193-26-000026` (10-K), `0000320193-26-000020` (10-Q), `0000320193-24-000081` (10-Q), `0001140361-26-035325` (8-K/A), one Form 4 row with `xslF345X06/form4.xml`, `files: []`, oldest row before 2021.
  - `CIK0000886982.json` + `CIK0000886982-submissions-001.json` + `-022.json`: GS with a few core and 424B2 rows each; the newest overflow file's oldest row is still after `2021-01-01`, the second's is before it. (GS's real `-002` covers 2025 only, so the fixture lists the real `-001` and `-022` and drops the files between.)
  - The other four companies: one core row each, `files: []`.
  - `test/fixtures/README.md`: one paragraph saying where they came from and that rows are unedited apart from removal.
- [ ] **Step 2: Write failing tests:**
  - `turns parallel arrays into rows and "" into null` (reportDate, primaryDocument)
  - `keeps only core forms but computes oldestFilingDate over all rows`
  - `strips milliseconds from acceptanceDateTime` (`2024-08-01T22:03:34.000Z` → `2024-08-01T22:03:34Z`)
  - one test per rejection rule in §9.3: not an object; missing `filings.recent`; unequal column lengths; wrong `cik`; bad `files[].name` (`'../x.json'`, `'CIK0000000001-submissions-001.json'` for another CIK); duplicate accession; core row with bad accession, impossible `filingDate` (`2024-02-30`), bad `reportDate`, bad `acceptanceDateTime` (`2024-08-01 22:03:34`), bad `primaryDocument` (`../a.htm`, `/a.htm`)
  - `skips odd values on non-core rows` (a 424B2 row with a bad reportDate does not reject)
  - `filing.spec`: `builds primaryDocumentUrl without CIK zeros and accession dashes` (→ `https://www.sec.gov/Archives/edgar/data/320193/000032019324000081/aapl-20240629.htm`); `keeps a folder in primaryDocument`; `null url when primaryDocument is null`; `compareFilings orders by filingDate, then acceptanceDateTime, then accession, all descending`.
- [ ] **Step 3: Run** both spec files → FAIL: modules not found.
- [ ] **Step 4: Implement** with zod for structure and plain checks for the per-row rules.
- [ ] **Step 5: Run** → PASS; full done check.
- [ ] **Step 6: Ask owner, then commit** `feat(sec): add SEC adapter, filing model and recorded fixtures`.

### Task 4: Loader and merge

**Files:**
- Create: `src/filings/merge.ts`, `src/filings/loader.ts`, `test/fakes/fake-sec-client.ts`
- Test: `test/unit/merge.spec.ts`, `test/unit/loader.spec.ts`

**Interfaces:**
- Consumes: `SecClient.getJson` shape, `SecError` (Task 2); adapter and `toFiling`, `compareFilings` (Task 3).
- Produces:
  - `mergeRefresh(old: readonly Filing[], fresh: readonly Filing[], recentOldest: string | null): Filing[]` — returns `fresh` + every `old` filing with `filingDate <= recentOldest` whose accession is not in `fresh`, sorted with `compareFilings`. When `recentOldest` is `null` (SEC's `recent` file had no rows), every old filing not in `fresh` is kept.
  - `type LoadResult = { ok: true; company: Company; filings: Filing[]; requests: number } | { ok: false; error: SecError | SecDataError; requests: number }`
  - `@Injectable() class Loader { constructor(@Inject(SEC_SOURCE) source: SecSource, @Inject(APP_CONFIG) cfg: Pick<AppConfig, 'filingsSince' | 'secArchivesBaseUrl'>, @Inject(APP_LOGGER) log: AppLogger); fullLoad(ticker: Ticker): Promise<LoadResult>; refresh(ticker: Ticker, previous: Filing[]): Promise<LoadResult> }`
  - `class FakeSecClient implements SecSource`, `constructor(files: Record<string, unknown | SecError>)`: `getJson` returns or throws the entry, throws `Error('unexpected SEC request: <name>')` for anything else, and records `calls: string[]`.

- [ ] **Step 1: Write failing tests:**
  - merge: the three rows of the §9.2 worked example (kept, dropped, added); `a row whose filingDate moved across R appears once, with the fresh values`; `rows on day R are kept from both sides without duplicates`.
  - loader `fullLoad`: `does not fetch overflow files when recent already reaches before FILINGS_SINCE` (AAPL: calls = `['CIK0000320193.json']`); `fetches overflow files newest first and stops after the first one older than FILINGS_SINCE` (GS: 3 calls in order); `stops when the overflow list ends`; `keeps only core forms with filingDate >= FILINGS_SINCE`; `fails and returns no filings if any file fails` (second overflow throws `SecError('network')`); `fails on adapter rejection`; `company exchange is the exchange at our ticker's index, or null`; `logs a warning when SEC's tickers list does not contain our ticker, and still loads` (§6; pass a logger spy as the `APP_LOGGER` constructor argument).
  - loader `refresh`: `fetches only the submissions file`; `applies the core-form and FILINGS_SINCE filter to fresh rows` (use `filingsSince` later than the recent file's oldest row; old-window rows must not appear).
- [ ] **Step 2: Run** → FAIL: modules not found.
- [ ] **Step 3: Implement.** `fullLoad` dedupes across files by accession with the `recent` row winning, then sorts. `refresh` filters fresh rows, then `mergeRefresh(previous, fresh, parsed.oldestFilingDate)`.
- [ ] **Step 4: Run** → PASS; full done check.
- [ ] **Step 5: Ask owner, then commit** `feat(filings): add loader with overflow stop rule and refresh merge`.

### Task 5: Store and refresh scheduler

**Files:**
- Create: `src/filings/filings.store.ts`, `src/filings/refresh.scheduler.ts`
- Test: `test/unit/store.spec.ts`, `test/unit/scheduler.spec.ts`

**Interfaces:**
- Consumes: `Loader`, `LoadResult` (Task 4); `COMPANIES` (Task 1).
- Produces:
  - `type CompanyStatus = 'not_loaded' | 'failed' | 'loaded' | 'stale'`
  - `interface CompanyState { ticker: Ticker; status: CompanyStatus; company: Company | null; filings: readonly Filing[]; dataAsOf: string | null; lastError: string | null; nextFullLoadAt: number | null }`
  - `interface StoreState { companies: ReadonlyMap<Ticker, CompanyState>; byAccession: ReadonlyMap<string, Filing>; firstPassDone: boolean }`
  - `interface FilingsStore { get(): StoreState; setCompany(state: CompanyState): void; markFirstPassDone(): void }` and Nest token `FILINGS_STORE` (add to `src/common/tokens.ts`).
  - `@Injectable() class InMemoryFilingsStore implements FilingsStore { constructor(@Inject(APP_LOGGER) log: AppLogger) }` — starts with all six `not_loaded`; every change builds a new frozen `StoreState`; logs a warning on an accession listed under two companies.
  - `isReady(state: StoreState): boolean` — `firstPassDone` and at least one company `loaded` or `stale`. `firstPassDone` is set only once every company has been tried (no company left `not_loaded`), so a 429 that stops the first run early does not make the service ready.
  - `interface SchedulerDeps { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }`, token `SCHEDULER_DEPS` (add to `tokens.ts`), default provider uses the real timers and `Date.now`.
  - `@Injectable() class RefreshScheduler implements OnApplicationBootstrap, OnModuleDestroy { constructor(@Inject(Loader) loader: CompanyLoader /* Pick<Loader, 'fullLoad' | 'refresh'> */, @Inject(FILINGS_STORE) store: FilingsStore, @Inject(APP_CONFIG) cfg: Pick<AppConfig, 'refreshIntervalSeconds' | 'failedCompanyRetrySeconds' | 'failedCompanyRetryMaxSeconds'>, @Inject(SCHEDULER_DEPS) deps: SchedulerDeps, @Inject(APP_LOGGER) log: AppLogger); runOnce(): Promise<{ nextDelayMs: number }>; start(): void; stop(): void; onApplicationBootstrap(): void /* calls start(), not awaited */; onModuleDestroy(): void /* calls stop() */ }`

- [ ] **Step 1: Write failing tests:**
  - store: `starts with six not_loaded companies and is not ready`; `get() returns the same object until a change` and `a change returns a new object` (old reference unchanged); `byAccession indexes every filing; on a duplicate accession keeps the first company in ticker order`; `isReady after first pass with one loaded company` and `not ready after first pass with none loaded`.
  - scheduler (fake loader, fake timers): `first run full-loads every company in ticker order and marks first pass done`; `a failed full load sets failed, lastError, nextFullLoadAt = now + max(interval, min(failedCompanyRetryMaxSeconds, failedCompanyRetrySeconds × 2^(failures−1))) (exponential backoff, owner decision 2026-11-20)`; `a failed company is skipped until nextFullLoadAt`; `a loaded company refreshes with its previous filings`; `a refresh failure sets stale and keeps filings and dataAsOf`; `a later success sets loaded and a new dataAsOf`; `429 stops the run; companies after it are untouched; nextDelayMs = max(interval, retryAfter)`; `403 stops the run`; `not_json during refresh sets stale and the run continues` (Review Focus 4); `start() schedules the next run only after the current one finishes` (runs never overlap).
- [ ] **Step 2: Run** → FAIL: modules not found.
- [ ] **Step 3: Implement.** `start()` calls `runOnce()`, then `setTimeout(next, nextDelayMs)`; `markFirstPassDone()` after the first `runOnce()`. One log line per company per run: `{ ticker, outcome, durationMs, requests, rows, errorKind }`.
- [ ] **Step 4: Run** → PASS; full done check.
- [ ] **Step 5: Ask owner, then commit** `feat(filings): add in-memory store and refresh scheduler`.

### Task 6: Query service and cursor

**Files:**
- Create: `src/common/problem.ts`, `src/filings/cursor.ts`, `src/filings/query.ts`, `src/filings/query.service.ts`
- Test: `test/unit/cursor.spec.ts`, `test/unit/query.spec.ts`

**Interfaces:**
- Consumes: `Filing`, `compareFilings` (Task 3); `StoreState`, `CompanyState` (Task 5); `CORE_FORMS`, `COMPANIES` (Task 1).
- Produces:
  - `class Problem extends Error { constructor(status: number, type: string, title: string, detail: string, errors?: { parameter: string; detail: string }[], retryAfterSeconds?: number) }` and factories `invalidParameter(errors)`, `invalidCursor(detail)`, `dateOutOfRange(detail)`, `companyNotFound(ticker)`, `filingNotFound(accession, filingsSince)`, `dataUnavailable(detail, retryAfterSeconds)` with the exact `type`/`title`/`detail` texts from §8 and §7.3.
  - `interface ListQuery { forms: string[] | null; filedFrom: string | null; filedTo: string | null; limit: number; cursor: DecodedCursor | null }` — the cursor is decoded and checked in `parseListQuery`, so a broken cursor is a parameter error (400) before the ticker check; `listFilings` compares its filters.
  - `parseListQuery(query: Record<string, unknown>, filingsSince: string): ListQuery` — throws `Problem`; all parameter problems in one `invalidParameter`; date-out-of-range after format checks.
  - `encodeCursor(k: [string, string, string], f: CursorFilters): string`, `decodeCursor(s: string): { k: [string, string, string]; f: CursorFilters }` with `interface CursorFilters { t: Ticker; forms: string[] | null; from: string | null; to: string | null }`.
  - `listFilings(filings: readonly Filing[], ticker: Ticker, q: ListQuery): { data: Filing[]; nextCursor: string | null }` — sorts a copy itself, so it does not rely on the caller's order.
  - `findFiling(state: StoreState, accession: string, filingsSince: string, retryAfterSeconds: number): Filing` — throws `invalidParameter`, `dataUnavailable` or `filingNotFound` per §7.3.
  - `@Injectable() class FilingsQueryService { constructor(@Inject(FILINGS_STORE) store: FilingsStore, @Inject(APP_CONFIG) cfg: AppConfig); getCompany(ticker: string): { company: Company; dataAsOf: string }; listCompanyFilings(ticker: string, query: Record<string, unknown>): { data: Filing[]; nextCursor: string | null; limit: number; dataAsOf: string }; getFiling(accession: string): { filing: Filing; dataAsOf: string } }` — applies the §7 check order (params → ticker → readiness → lookup) on top of the pure functions above; controllers call only this service.
  - Test: `test/unit/query.service.spec.ts` builds it with an `InMemoryFilingsStore` and checks the check order (`?form=4` on `GOOG` → 400, not 404; unknown ticker while loading → 404, not 503).

- [ ] **Step 1: Write failing tests:**
  - cursor: `round trips`; `matches the spec example string exactly` (the §7.2 `nextCursor`); `rejects bad base64, bad JSON, v != 1, malformed k`.
  - parseListQuery: `defaults limit to 20`; `canonicalises forms: upper case, deduped, sorted`; `rejects empty form items`, `unsupported form '4'` (detail lists supported forms), `unknown parameter`, `repeated parameter` (array value); limit cases `0`, `101`, `10.5`, `abc`, `''` (Review Focus 2); dates `2025-02-30`, `2025-13-01`, `20250101` (Review Focus 3); `filedFrom after filedTo`; `filedFrom or filedTo before FILINGS_SINCE → date-out-of-range`; `collects several problems in one error`.
  - listFilings: `newest first with ties broken by acceptanceDateTime then accession`; `filters by forms and inclusive dates`; `returns nextCursor null when no more rows, including when exactly limit rows remain`; `continues after the cursor`; `rejects a cursor whose filters differ, but accepts forms in another order`; `a filing added before the cursor position between pages causes no duplicate or skip`.
  - findFiling: `200 path returns the filing`; `bad format → invalid-parameter` (`'123'`, 18-digit form); `unknown accession while a company is not_loaded → data-unavailable`; `unknown accession when all loaded → filing-not-found`.
- [ ] **Step 2: Run** → FAIL: modules not found.
- [ ] **Step 3: Implement.** Pagination: filter, then take rows strictly after `k` in `compareFilings` order, read `limit + 1`. Cursor: base64url without padding of `JSON.stringify({ v: 1, k, f })`.
- [ ] **Step 4: Run** → PASS; full done check.
- [ ] **Step 5: Ask owner, then commit** `feat(filings): add query service, cursor pagination and problem types`.

### Task 7: Postman test profile (written before the HTTP layer)

**Files:**
- Create: `postman/filings-api.postman_collection.json` (v2.1 JSON collection; owner asked for JSON instead of v3 YAML), `postman/local.environment.json` (`baseUrl = http://localhost:3000`)

**Interfaces:**
- Consumes: the contract in §7, §8 and the checks table in §11.2 (not the code).
- Produces: a collection whose run command is recorded for the README in Task 9.

- [ ] **Step 1: Write the collection** with one folder per endpoint (Health, Companies, Filings list, Filing by accession), each request carrying the `pm.test` assertions from §11.2. Collection-level test script: for any 4xx/5xx response, assert `Content-Type` `application/problem+json` and the five fields, with `status` equal to the HTTP status. The cursor walk stores `nextCursor` in a collection variable and checks accessions across 3 pages.
- [ ] **Step 2: Run it with no service running** `postman collection run postman/filings-api.postman_collection.json -e postman/local.environment.json` → FAIL (connection refused). This is the "test fails first" step for the HTTP layer.
- [ ] **Step 3: Ask owner, then commit** `test(api): add Postman collection and local environment for all endpoints`.

### Task 8: HTTP layer, health, logging and bootstrap

**Files:**
- Create: `src/common/problem.filter.ts`, `src/filings/companies.controller.ts`, `src/filings/filings.controller.ts`, `src/health/health.controller.ts`, `src/app.module.ts`, `src/main.ts`
- Test: `test/e2e/api.e2e-spec.ts`

**Interfaces:**
- Consumes: everything above. `AppModule` is a plain module importing `AppConfigModule`, `LoggerModule`, `SecModule`, `FilingsModule` and `HealthModule`. Tests build it with `Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(cfg).overrideProvider(SEC_SOURCE).useValue(new FakeSecClient(...))`.
- Produces: the routes in §7: `GET /v1/companies/:ticker`, `GET /v1/companies/:ticker/filings`, `GET /v1/filings/:accessionNumber`, `GET /health/live`, `GET /health/ready`.

- [ ] **Step 1: Write failing E2E tests** (supertest against `AppModule` with `SEC_SOURCE` overridden by `FakeSecClient`, after awaiting the first `runOnce()`):
  - `GET /v1/companies/aapl → 200` with the §7.1 body shape and `meta.dataAsOf`; `GET /v1/companies/GOOG → 404 company-not-found` as problem+json.
  - odd tickers `AAPL.`, `%20AAPL`, 200 × `A` → 404 `company-not-found` (Review Focus 1).
  - `GET /v1/companies/AAPL/filings?form=10-K,10-Q&limit=2 → 200` with the two §7.2 rows and `nextCursor` equal to the spec example; `?form=4 → 400 invalid-parameter`.
  - `GET /v1/filings/0000320193-24-000081 → 200` equal to the §7.3 example (except `dataAsOf`); `GET /v1/filings/123 → 400`.
  - `GET /v1/unknown → 404 not-found` as problem+json; an internal error → 500 `internal-error` with no stack trace in the body.
  - readiness: with a fake client where every file throws `SecError('network')`: `/health/live 200`, `/health/ready 503` with `status: loading` before the first pass and still 503 after it (none loaded), `/v1/companies/AAPL → 503 data-unavailable` with `Retry-After: 60` (Review Focus 5). With good fixtures: `/health/ready 200`, six companies listed.
- [ ] **Step 2: Run** `npm run test:e2e` → FAIL: `AppModule` not found.
- [ ] **Step 3: Implement.** Controllers inject `FilingsQueryService` (and `HealthController` injects `FILINGS_STORE`) and wrap results as `{ data, meta: { dataAsOf } }` / `{ data, page: { limit, nextCursor }, meta }`. Check order per §7 (params → ticker → readiness → lookup). `ProblemFilter` maps `Problem`, Nest `NotFoundException` (unknown route) and anything else (500, logged). Logging via `nestjs-pino` with `genReqId: () => randomUUID()`. Logging: nestjs-pino reuses the `APP_LOGGER` pino instance. `main.ts`: `NestFactory.create(AppModule)`; a `ConfigError` thrown by the `APP_CONFIG` factory is printed and the process exits with code 1; log the config; `listen(APP_CONFIG.port)`. The scheduler starts from its `onApplicationBootstrap` hook without being awaited, so liveness answers during loading.
- [ ] **Step 4: Run** `npm run test:e2e` → PASS; full done check.
- [ ] **Step 5: Run the service and Postman against it:** `SEC_USER_AGENT="<owner's value>" npm run build && npm start`, wait for `/health/ready` 200, then the Postman command → all assertions pass. Report the assertion counts and exit code.
- [ ] **Step 6: Ask owner, then commit** `feat(api): add v1 controllers, problem+json errors, health and bootstrap`.

### Task 9: Docker, README and NOTES

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `README.md`, `NOTES.md`

**Interfaces:**
- Consumes: npm scripts (Task 1), Postman command (Task 7).

- [ ] **Step 1: Write the check first:** README "Verify" section lists the commands; running them now fails because there is no Dockerfile (`docker build -t filings-api .` → error).
- [ ] **Step 2: Dockerfile**, minimal single stage: `FROM node:26.13.1-alpine`, `npm ci`, `npm run build`, `npm prune --omit=dev`, `CMD ["node", "dist/main.js"]`, `EXPOSE 3000`. No `SEC_USER_AGENT` in the image.
- [ ] **Step 3: README:** prerequisites (Node 26.13.1, npm 11, Docker, Postman CLI), install, configure (table from §10, `.env.example`), run locally, run in Docker (`docker run -e SEC_USER_AGENT=... -p 3000:3000 filings-api`), test (`npm test`, `npm run test:e2e`, lint, typecheck, audit, Postman), endpoint summary with links to the spec.
- [ ] **Step 4: NOTES.md**, one page: what we built, what we skipped and why (hardening list and the cut items from §2), what we'd do next (§12 triggers, §13 limits), deviations (TypeScript 6.0.3, any found during the build).
- [ ] **Step 5: Verify from a clean clone:** `git clone` the branch into the scratchpad, run every README command as written (install, lint, typecheck, test, test:e2e, audit, build, start with the owner's `SEC_USER_AGENT`, Docker build and run, Postman run). Fix the README until every command works unchanged.
- [ ] **Step 6: Ask owner, then commit** `docs: add README, NOTES and Dockerfile`.

## Time budget

| Task | Estimate |
|---|---|
| 1 Scaffold and config | 15 min |
| 2 SEC client | 15 min |
| 3 Adapter and fixtures | 20 min |
| 4 Loader and merge | 15 min |
| 5 Store and scheduler | 15 min |
| 6 Query and cursor | 15 min |
| 7 Postman | 10 min |
| 8 HTTP layer | 15 min |
| 9 Docker and docs | 10 min |
| **Total** | **about 2 h 10 min** |

Owner approval waits between tasks are not counted. If we run over, apply the §2 ranking: shrink Task 7 to one request plus one error per endpoint first, then trim Task 9 wording.
