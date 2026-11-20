import { CORE_FORMS, type Ticker } from '../companies';
import { isRealDate } from '../config/config';
import {
  dataUnavailable,
  dateOutOfRange,
  filingNotFound,
  invalidCursor,
  invalidParameter,
  supportedFormsText,
  type ParameterError,
} from '../common/problem';
import { decodeCursor, encodeCursor, type CursorFilters, type DecodedCursor } from './cursor';
import { compareFilings, compareSortKeys, sortKeyOf, type Filing } from './filing';
import type { StoreState } from './filings.store';

/** Pure query logic (spec §7.2, §7.3). Throws Problem for every client error. */

export interface ListQuery {
  /** Canonical: upper case, deduped, sorted; null = no form filter. */
  forms: string[] | null;
  filedFrom: string | null;
  filedTo: string | null;
  limit: number;
  /** Already decoded and checked; its filters are compared in listFilings. */
  cursor: DecodedCursor | null;
}

const PARAMETERS = new Set(['form', 'filedFrom', 'filedTo', 'limit', 'cursor']);
const FORMS = new Set(CORE_FORMS);
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parseListQuery(query: Record<string, unknown>, filingsSince: string): ListQuery {
  const errors: ParameterError[] = [];
  const values = new Map<string, string>();
  for (const [name, value] of Object.entries(query)) {
    if (!PARAMETERS.has(name)) {
      errors.push({
        parameter: name,
        detail: `Unknown parameter. Allowed: ${[...PARAMETERS].join(', ')}.`,
      });
    } else if (typeof value !== 'string') {
      errors.push({ parameter: name, detail: 'Given more than once; give it once.' });
    } else {
      values.set(name, value);
    }
  }

  let forms: string[] | null = null;
  const formText = values.get('form');
  if (formText !== undefined) {
    const items = formText.split(',').map((f) => f.toUpperCase());
    if (items.some((f) => f === '')) {
      errors.push({ parameter: 'form', detail: `Has an empty item. ${supportedFormsText}` });
    } else {
      const bad = items.filter((f) => !FORMS.has(f));
      if (bad.length > 0) {
        errors.push({
          parameter: 'form',
          detail: `'${bad.join(', ')}' is not supported. ${supportedFormsText}`,
        });
      } else {
        forms = [...new Set(items)].sort();
      }
    }
  }

  const date = (name: 'filedFrom' | 'filedTo'): string | null => {
    const v = values.get(name);
    if (v === undefined) return null;
    if (isRealDate(v)) return v;
    errors.push({ parameter: name, detail: 'Must be a real date in YYYY-MM-DD format.' });
    return null;
  };
  const filedFrom = date('filedFrom');
  const filedTo = date('filedTo');
  if (filedFrom !== null && filedTo !== null && filedFrom > filedTo) {
    errors.push({ parameter: 'filedFrom', detail: 'Must not be after filedTo.' });
  }

  let limit = DEFAULT_LIMIT;
  const limitText = values.get('limit');
  if (limitText !== undefined) {
    const n = /^\d+$/.test(limitText) ? Number(limitText) : NaN;
    if (n >= 1 && n <= MAX_LIMIT) limit = n;
    else errors.push({ parameter: 'limit', detail: `Must be an integer from 1 to ${MAX_LIMIT}.` });
  }

  if (errors.length > 0) throw invalidParameter(errors);

  for (const [name, d] of [
    ['filedFrom', filedFrom],
    ['filedTo', filedTo],
  ] as const) {
    if (d !== null && d < filingsSince) {
      throw dateOutOfRange(`Filings are available from ${filingsSince}; ${name} ${d} is earlier.`);
    }
  }

  const cursorText = values.get('cursor');
  const cursor = cursorText === undefined ? null : decodeCursor(cursorText);
  return { forms, filedFrom, filedTo, limit, cursor };
}

/** One page of a company's filings, newest first, after the cursor if given. */
export function listFilings(
  filings: readonly Filing[],
  ticker: Ticker,
  q: ListQuery,
): { data: Filing[]; nextCursor: string | null } {
  const filters: CursorFilters = { t: ticker, forms: q.forms, from: q.filedFrom, to: q.filedTo };
  if (q.cursor && JSON.stringify(q.cursor.f) !== JSON.stringify(filters)) {
    throw invalidCursor(
      'The cursor was issued for different filters. Use the same form, filedFrom and filedTo as the first request.',
    );
  }
  const forms = q.forms ? new Set(q.forms) : null;
  const after = q.cursor?.k;
  const matching = [...filings]
    .sort(compareFilings)
    .filter(
      (f) =>
        (forms === null || forms.has(f.form)) &&
        (q.filedFrom === null || f.filingDate >= q.filedFrom) &&
        (q.filedTo === null || f.filingDate <= q.filedTo) &&
        (after === undefined || compareSortKeys(sortKeyOf(f), after) > 0),
    );
  const page = matching.slice(0, q.limit + 1);
  const data = page.slice(0, q.limit);
  const last = data[data.length - 1];
  const nextCursor = page.length > q.limit && last ? encodeCursor(sortKeyOf(last), filters) : null;
  return { data, nextCursor };
}

/** Accession lookup across all companies (spec §7.3). */
export function findFiling(
  state: StoreState,
  accession: string,
  filingsSince: string,
  retryAfterSeconds: number,
): Filing {
  if (!ACCESSION.test(accession)) {
    throw invalidParameter(
      [{ parameter: 'accessionNumber', detail: 'Must look like 0000320193-24-000081.' }],
      `'${accession.slice(0, 30)}' is not an accession number. Expected the form 0000320193-24-000081.`,
    );
  }
  const filing = state.byAccession.get(accession);
  if (filing) return filing;
  const missing = [...state.companies.values()].filter(
    (c) => c.status === 'not_loaded' || c.status === 'failed',
  );
  if (missing.length > 0) {
    throw dataUnavailable(
      `Not every company has loaded yet (${missing.map((c) => c.ticker).join(', ')}), so we cannot say this filing does not exist. Try again later.`,
      retryAfterSeconds,
    );
  }
  throw filingNotFound(accession, filingsSince);
}
