# Test fixtures

Trimmed copies of real SEC files downloaded from `https://data.sec.gov/submissions/` on
2026-11-20 (see `docs/research/sec-findings.md`). Rows and values are unedited: the only
change is removal of rows, top-level fields we do not read, and entries in `filings.files[]`.

- `CIK0000320193.json` (AAPL): the filings used in the spec's examples, a Form 4 whose
  `primaryDocument` has a folder, and the oldest row (2015), so no overflow file is needed.
- `CIK0000886982.json` (GS) lists two real overflow files, `-001` (2025) and `-022`
  (2020-12-28 to 2021-03-25); the ones between were removed. `-022` reaches before
  2021-01-01, so loading stops after it. Its listed `filingTo` (2021-03-24) is a day
  earlier than its newest row, as SEC's metadata often is.
- The other four companies: one core filing each and no overflow files.

Tests that need malformed data copy a fixture and change it in the test itself.
