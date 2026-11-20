# Prompt log

How the owner directed and checked the AI assistant while building this API. Prompts are
the owner's own words from the session, with typos fixed and long lists shortened with
"…"; nothing is added. Routine replies ("yes", "proceed", commit approvals) are left out.
"Why" is taken from the prompt itself or from the owner's CLAUDE.md; where no reason was
given it says *not stated*.

| | |
|---|---|
| Tool | Claude Code (VS Code extension), with superpowers and Postman plugins |
| Model | Claude Opus 5.5 (`claude-opus-5-5`); fresh-context reviewers: spec review on the same model, final code review on Opus |
| Date | 2026-11-20, one session |
| Result | branch `feat/core-milestone`, 14 commits, each approved by the owner before it was made |

## Standing rules (from the owner's CLAUDE.md)

| Rule | Effect on the work |
|---|---|
| Verify, don't assume; check SEC data, npm and docs; cite numbers | Every SEC fact was measured live and tagged with its source ([research](research/sec-findings.md)) |
| Challenge with evidence, including the owner's requests and the brief | Plans changed when data contradicted them (table below) |
| Gates: SEC findings → options → scope → spec → toolchain check → plan → build | Work stopped for approval at each gate |
| Requests never call SEC; one validated adapter maps SEC data | Load-and-refresh architecture; one adapter |
| Current versions; `npm audit` 0, fixed by upgrading, overriding or replacing | Toolchain check before the build; overrides for 18 moderate findings |
| Test-first; done means lint, types, tests, audit clean | Every task: failing test first, then code |
| Config from env only; `SEC_USER_AGENT` required, no default | Checked at startup; service exits if missing |
| Ask before every commit; no secrets, no AI attribution, no push/merge without asking | 14 commits, each shown and approved first |
| No stale docs; diagrams in Mermaid | Docs changed in the same commit as code; three Mermaid diagrams in the spec |

## Prompts that steered the work

| # | What the owner asked | Why | What came out |
|---|---|---|---|
| 1 | "First read the brief … Don't design anything yet, I just want facts about the SEC data. Pull data.sec.gov/submissions for all six companies and check …" (structure and counts, empty fields, GOOG vs GOOGL, shared accession numbers, UTC, primary document URLs, rate limit, User-Agent, caching). "Tell me where each answer came from. Then list only the questions I need to answer before we design." | Gate: SEC findings | Facts with sources; 5 questions for the owner |
| 2 | "Restrict to core forms with time window; filing date with UTC time; primary [tickers] mentioned in PDF; refresh at interval, configurable through an env var, default 1 min; … production grade app with proper documentation … Important to keep it simple and scoped to the requirements." | Answers to #1 | Scope proposal: core forms incl. amendments, fixed `FILINGS_SINCE`, cursor pagination |
| 3 | "Fetching from SEC per request with a cache, load everything at start up and refresh on a timer, or a separate loader writing to a shared store. Be critical about each one including the one you would pick." | "I care about what happens when data provider is down, latency, cache stampedes, staying under SEC's rate limit, pagination not breaking when data refreshes" | Option 2 (load + refresh) chosen, with switch triggers to a shared store |
| 4 | "Lock scope for API keys, per-client rate limits, API versioning, error format, caching headers and observability … split the work into a core milestone and a hardening one. Each should deliver on its own and the core one has to fit the time box." | Gate: scope | In/out table; core vs hardening split |
| 5 | "Cover the overview, scope, constraints, what we found from the data, architecture, data model, API contract with examples, errors, data loading, env config, testing, scaling, known limits. Keep the language plain." Pasted: "Draw the diagrams in Mermaid, only where a picture explains more than the text": a flowchart of the components showing that requests never reach SEC, a sequence diagram of startup loading and the scheduled refresh, a state diagram of readiness. "Get a fresh reviewer to read it as if they had to build from it. Fix what you can yourself and only bring me the calls that are mine." | Gate: spec | Spec plus findings doc; fresh review; 2 owner calls brought back (readiness, time box) |
| 6 | "D1 (a) but we need to have retries. D2: cut to the scoped 2 hours based on the priority; need a Postman test profile to test all the endpoints." | Owner calls from #5 | Retry rules in the SEC client; ranked 2-hour cut; Postman section in the spec |
| 7 | "Create a feature branch and work through the tasks one at a time. Write each test first and make sure it fails before you write the code. Commit after every task; I will approve each one. Mention when deviation happens." | CLAUDE.md: test-first, ask before commit | Toolchain check and plan, then 9 tasks, each RED → GREEN → approved commit; deviations listed per task |
| 8 | "Approved; [`SEC_USER_AGENT` =] Test Company@example.com; proceed with implementation." | Gate: toolchain and plan | Build started |
| 9 | "Add gitignore file." | not stated | `.gitignore` in Task 1 |
| 10 | "Do not use any hardcoded config. Make it configurable through env var, e.g. base URL." | not stated | 6 new env vars (SEC URLs, rate, retries, failed-company retry) |
| 11 | "Also follow design principles, use dependency injection." | not stated | Nest DI with tokens and interfaces; plan rewritten for later tasks |
| 12 | "Would the cursor be updated dynamically when data refreshed?" | not stated | Explained: the cursor stores a position, not a snapshot |
| 13 | "Change the Postman artifacts to be a JSON collection and environment JSON." / "Make it importable JSON files." | not stated | v2.1 JSON collection and environment; checked with Postman's own parser |
| 14 | "Run it against the real SEC API now. How long until it's ready, how much memory, how fast are the list pages? Compare with the targets in the spec and look through the logs for warnings. If the spec turns out to be wrong, fix the spec." | not stated | Live measurements; spec memory claim corrected; baselines added |
| 15 | "Go through every doc and make sure it still matches the code. README first … clone the repo into a temp folder and follow the README exactly … Then NOTES.md, one page, for a reviewer who has five minutes … Commit together with any fixes." | not stated | Spec, README and NOTES fixed; README proven from a clean clone |
| 16 | "Update [CLAUDE.md]; keep latency target out of scope, Retry-After can increase exponentially; keep [the branch] as it is." | Owner calls from #14–#15 | Exponential backoff for failing companies; real `Retry-After` on 503 |
| 17 | "Run the app one more time and update any stale docs or comments, check package vulnerability once again and fix if needed." | not stated | Final live run; 3 stale code comments fixed; audit 0 |
| 18 | This log. | not stated | This file |

## Claims and plans that changed because of evidence

| Before | Evidence | Changed to |
|---|---|---|
| Overflow file date ranges can choose which files to fetch (7-day margin) | 45 of 48 files' `filingFrom`/`filingTo` disagree with their rows, by up to 6 days | Fetch newest first, stop on the rows' own dates |
| About 450 core filings; GS "a few dozen" (assistant, from 2 of 39 GS files) | Fetching all 39 GS files: GS 146, total 567 | Numbers corrected in spec and findings |
| Core forms = 10-K, 10-Q, 8-K | 33 amendments in the data; an amended 10-K replaces the original's numbers | `/A` amendments included |
| Rolling "last N years" window | A rolling window turns old accession lookups into 404s over time | Fixed `FILINGS_SINCE` |
| Page-number pagination | Data refreshes every minute; new filings would shift pages | Cursor on SEC's sort order |
| Latest stable TypeScript (7.0.2) | TS 7 has no classic compiler API; Nest CLI pins `~6.0.2`, typescript-eslint `<6.1.0`, ts-jest `<7` | TypeScript 6.0.3 |
| Trial install: 18 moderate `npm audit` findings | All via Jest's `glob`/`minimatch` | `overrides` to patched versions → 0 |
| Jest runs Nest like plain Node | Nest 12 is ESM-only; Jest failed to load it; plain Node 26 loaded the compiled app | Jest runs with `--experimental-vm-modules` |
| Plan: empty SEC `recent` file → merge boundary = `FILINGS_SINCE` | Would silently drop every older filing (assistant caught in Task 4) | Empty `recent` keeps all old rows |
| Plan: first pass done after the first run | A 429 can stop the first run before every company is tried | Done only when every company was tried |
| Plan: cursor decoded after the ticker check | `GOOG` + broken cursor would give 404, not 400 | Cursor decoded while parsing parameters |
| Spec: memory "well under 1 MB" | That is the data (166 KB); the process uses 158–222 MB RSS | Spec gives both, says which to size for |
| Spec and README: the loader writes the store | Code: the scheduler writes it and logs per company | Diagrams, tables and text corrected |
| Dropping the Nest CLI removes npm's install-script warning (assistant) | The script comes from Jest (`jest-haste-map`) | Plan text corrected |
| `postman collection lint` checks the JSON collection | It scans 0 entities for v2.1 JSON | Collection checked by running it and by Postman's migrate tool |
| Assistant ran `prettier --write .` | It reformatted committed docs and the owner's untracked CLAUDE.md and settings.json | Files restored byte for byte; Prettier limited to `src/` and `test/` |
| Two of the assistant's tests | Retry test ignored request spacing; reset test spent its mocks on the wrong companies | Tests fixed, code unchanged |

### Reviewer claims rejected or kept against the reviewer

| Reviewer claim | Evidence | Decision |
|---|---|---|
| Spec review: SEC's `cik` is not zero-padded | Submissions JSON has `"cik": "0000320193"` | Rejected |
| Spec review: startup is 45–50 requests, not 31 | Counted from `files[]`; live runs made 31 requests | Rejected |
| Spec review: example filings not backed by data | Both rows copied from the recorded `CIK0000320193.json` | Rejected; source now cited |
| Code review: a 429 on an unloaded company should not start the 5-minute wait | Readiness is not delayed (the company counts as tried); backing off after 429 is the safe side | Kept as built |
| Code review: truncating echoed input has no effect because `instance` echoes the path | True for `instance`; truncation still limits the `detail` | Kept as built |

## Verification

| Check | Result |
|---|---|
| Unit and end-to-end tests | 211 unit + 16 e2e = 227 passing, no SEC calls |
| Coverage (unit + e2e) | statements 96.4%, branches 95.4%, functions 95.5%, lines 96.3%; only `main.ts` untested (covered by live runs) |
| Lint, types | clean on every commit |
| `npm audit` | 18 moderate on trial install → 0 with overrides; 0 at the end |
| Postman collection | 41/41 assertions, 20 requests: against local, the container, and the final run |
| Live run (default config) | ready 7.2 s; 31 SEC requests; 567 filings; 158 MB RSS ready, 207–222 MB under load; 0 warnings |
| Latency (same machine) | list page p99 0.7 ms one client; p99 7.4 ms with 50 clients at ~15,000 requests/s; refresh pause ≤ 27 ms |
| Refresh | 6 SEC requests, 1.3–2.6 s |
| Container | image 321 MB, no `SEC_USER_AGENT` baked in; ready 8.0 s; README `curl` calls 200 |
| README from a clean clone | every command run as written: install, build, start, Docker, tests, audit, Postman all passed |
| Spec review (fresh reviewer) | 10 blockers, 13 correctness risks, 2 diagram issues, 3 scope notes; author fixes applied, 2 owner calls |
| Final code review (fresh reviewer) | 0 critical, 2 important, 10 minor/spec; fixed: unbounded `Retry-After` (1 ms retry loop), unguarded refresh loop, `dataAsOf` overstating freshness, 2 doc overclaims; 7 minors deferred (the main ones are in [NOTES](../NOTES.md) under "next") |
