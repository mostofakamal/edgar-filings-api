# SEC EDGAR findings

What we learned about SEC data before designing the API. Every number here was measured
on **2026-11-20** against live SEC endpoints. Re-check before relying on anything that can
drift (counts, headers, ticker lists).

**Sources** (each finding is tagged). Raw downloads were kept outside the repo; the test
fixtures in `test/fixtures/` are trimmed, unedited copies of them.

- **[J]** `https://data.sec.gov/submissions/CIK##########.json` and the overflow files it lists
- **[T]** `https://www.sec.gov/files/company_tickers.json` and `company_tickers_exchange.json`
- **[I]** filing index pages, `https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{acc}-index.htm`
- **[H]** HTTP response headers and status codes we observed
- **[D]** SEC documentation: [Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data),
  [Webmaster FAQ](https://www.sec.gov/about/webmaster-frequently-asked-questions),
  [EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces),
  [Developer Resources](https://www.sec.gov/about/developer-resources)

## 1. How filings are structured

- Each company file holds filings as **parallel arrays** (one array per column, same length)
  under `filings.recent`. Columns: `accessionNumber, filingDate, reportDate,
  acceptanceDateTime, act, form, fileNumber, filmNumber, items, core_type, size, isXBRL,
  isInlineXBRL, isXBRLNumeric, primaryDocument, primaryDocDescription`. [J]
- `recent` holds at least one year of filings or 1,000 filings, whichever is more. Older
  filings are in overflow files listed in `filings.files[]`, same columns. [D][J]
- `recent` is sorted by `filingDate` descending, then `acceptanceDateTime` descending
  (0 exceptions across all six companies). It is **not** sorted by `acceptanceDateTime`
  alone. [J]
- The `filingFrom` / `filingTo` dates in `filings.files[]` are **approximate**: 45 of all
  48 overflow files disagreed with their contents, by up to 6 days, in both directions
  (e.g. GS file-001 says it ends 2025-11-18 but contains 2025-11-19). [J]
- `filings.files[]` is listed newest first for all six companies, and the files do not
  overlap (0 duplicate accessions across `recent` and all overflow files). [J]
- Overflow files contain only the column arrays: no `cik`, no `name`. The submissions file's
  `cik` is a zero-padded 10-digit string, e.g. `"0000320193"`. [J]
- No duplicate accession numbers within a company. [J]

| Company | CIK | Total filings | In `recent` | Overflow files |
|---|---|---|---|---|
| AAPL | 320193 | 2,283 | 1,005 | 1 |
| META | 1326801 | 4,257 | 1,003 | 2 |
| GOOGL | 1652044 | 2,737 | 1,002 | 1 |
| AMZN | 1018724 | 3,147 | 1,000 | 2 |
| NFLX | 1065280 | 6,212 | 1,004 | 3 |
| GS | 886982 | 94,726 (SEC's count) | 16,632 (one year) | 39 |

Most rows are not the reports customers want. Form 4 (insider trades) is 60–84% of the
tech companies' rows. GS is 92% form 424B2 (structured-note prospectuses), up to 293 in a
single day. [J]

Core-form rows (10-K, 10-Q, 8-K and their `/A` amendments) filed since 2021-01-01, all
files checked: AAPL 75, META 90, GOOGL 91, AMZN 86, NFLX 79, GS 146. **567 in total.**
Each company has 6 10-Ks and 18 10-Qs in that window; the rest are 8-Ks and amendments. [J]

Loading everything since 2021-01-01, fetching overflow files newest first and stopping at
the first file that contains a row older than that date, takes **31 requests**: 6
submissions files plus 25 overflow files (GS 22, META 1, GOOGL 1, NFLX 1). [J]

## 2. Missing values

- Every column is present on every row. Missing text values are **empty strings `""`**,
  not `null`. Exceptions: `isXBRLNumeric` is `null` on 28,306 of 39,291 rows; `core_type`
  is `null` once. [J]
- `reportDate` was never empty on 10-K, 10-Q, 8-K or their amendments. It is always empty
  on 424B2, S-8 and SC 13G. [J]
- `primaryDocument` is `""` on 271 filings, all from 1994–2000. Some filings point at a
  `.paper` placeholder (71) or a `.pdf` (150). [J]

## 3. Tickers, CIKs, exchanges

- GOOG and GOOGL both map to CIK 1652044. Alphabet also lists GOOGM and GOOGN; Meta lists
  METAM; GS lists GS, GS-PA, GS-PC, GS-PD (NYSE) and GSCE (OTC). [T][J]
- `tickers[]` and `exchanges[]` in the submissions file are parallel arrays matched by
  position, and they agree with `company_tickers_exchange.json`. [T][J]
- Old tickers are dropped: FB returns nothing. Only `formerNames` remembers Facebook. [T][J]

## 4. Accession numbers

- The first 10 digits of an accession number identify **who submitted** the filing
  (often a filing agent), not the company. Only 514 of Apple's 2,283 accessions start with
  Apple's CIK. [J]
- The same accession can be listed under several companies. Form 4 `0001140361-26-044952`
  is under Apple (issuer) and the insider (reporting owner). 424B2 `0001193125-26-469592`
  is under GS Group and GS Finance Corp. [I][J]
- Among our six companies we found no shared accessions (all files checked). [J]

## 5. Time zones

`acceptanceDateTime` is real UTC. The index page shows US Eastern time without saying so. [J][I]
The raw value always has milliseconds, e.g. `"2024-08-01T22:03:34.000Z"`; every row we
checked ends in `.000Z`. [J]

| Accession | JSON (UTC) | Index page "Accepted" | Offset |
|---|---|---|---|
| 0000320193-24-000081 (10-Q) | 2024-08-01T22:03:34Z | 2024-08-01 18:03:34 | −4h (EDT) |
| 0000320193-24-000006 (10-Q) | 2024-02-01T23:03:38Z | 2024-02-01 18:03:38 | −5h (EST) |
| 0000320193-23-000093 (Form 4) | 2023-10-04T01:09:17Z | 2023-10-03 21:09:17 | −4h |
| 0001193125-26-469592 (424B2) | 2026-11-20T16:22:28Z | 2026-11-20 11:22:28 | −5h |

`filingDate` is SEC's business date in Eastern time. Filings submitted after 5:30 pm ET
(10 pm for Forms 3/4/5) get the next business day. [D] On 5,510 rows the date part of
`acceptanceDateTime` differs from `filingDate`, so one cannot be derived from the other. [J]

## 6. Primary document URL

- Pattern: `https://www.sec.gov/Archives/edgar/data/{CIK without leading zeros}/{accession without dashes}/{primaryDocument}`.
  Example: `https://www.sec.gov/Archives/edgar/data/320193/000032019324000081/aapl-20240629.htm` returns 200. [H]
- 15,594 filings have a folder in `primaryDocument`, all XML forms (4, 3, 5, 144, SCHEDULE
  13G, 13F-HR), e.g. `xslF345X06/form4.xml`. The folder is an SEC stylesheet view: with it
  you get HTML, without it the raw XML. No core form has a folder. [J][H]
- A CIK with leading zeros in the path gets a 301 redirect to the unpadded form. [H]

## 7. Rate limit, User-Agent, caching, freshness

- **Rate limit:** 10 requests per second per user, "regardless of the number of machines".
  SEC may block IPs that go over. We did not test the over-limit behaviour. [D]
- **User-Agent:** SEC asks for `User-Agent: Sample Company Name AdminContact@<domain>.com`
  and `Accept-Encoding: gzip, deflate`. [D] No User-Agent or an empty one gets **403** with
  an HTML "Undeclared Automated Tool" page (not JSON). A bare `Mozilla/5.0` got 200, so
  passing the check does not mean we comply. [H]
- **Caching:** `data.sec.gov` sends no `Cache-Control`, `ETag`, `Last-Modified` or
  `Expires`, and answers `If-Modified-Since` / `If-None-Match` with a full 200. Every
  refresh is a full download. `www.sec.gov/Archives` sends `Last-Modified` and supports 304.
  [H]
- **Sizes:** GS `recent` is 2.6 MB of JSON (307 KB gzipped). [J][H]
- **Freshness:** submissions update in real time, typically under a second after a filing
  is published. A nightly bulk `submissions.zip` is rebuilt at about 3:00 am ET. [D]
- **Corrections:** SEC staff can remove or correct filings after acceptance. [D]
