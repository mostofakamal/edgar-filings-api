import { COMPANIES, CORE_FORMS, type Ticker } from '../companies';
import { isRealDate } from '../config/config';
import { invalidCursor } from '../common/problem';
import type { SortKey } from './filing';

/** The filters a cursor was issued for, in canonical form (spec §7.2). */
export interface CursorFilters {
  t: Ticker;
  forms: string[] | null;
  from: string | null;
  to: string | null;
}

export interface DecodedCursor {
  k: SortKey;
  f: CursorFilters;
}

const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const TICKERS = new Set<string>(COMPANIES.map((c) => c.ticker));
const FORMS = new Set(CORE_FORMS);

/** base64url (no padding) of JSON {v: 1, k, f}. Key order is fixed so equal inputs give equal cursors. */
export function encodeCursor(k: SortKey, f: CursorFilters): string {
  const body = { v: 1, k, f: { t: f.t, forms: f.forms, from: f.from, to: f.to } };
  return Buffer.from(JSON.stringify(body)).toString('base64url');
}

/** Decodes and checks every part of a cursor; throws 400 invalid-cursor on any problem. */
export function decodeCursor(s: string): DecodedCursor {
  const fail = () => invalidCursor('The cursor is not valid. Start again from the first page.');
  if (!BASE64URL.test(s)) throw fail();
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  } catch {
    throw fail();
  }
  if (!isObject(raw) || raw.v !== 1 || !isSortKey(raw.k) || !isFilters(raw.f)) throw fail();
  return { k: raw.k, f: raw.f };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSortKey(v: unknown): v is SortKey {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'string' &&
    isRealDate(v[0]) &&
    typeof v[1] === 'string' &&
    DATE_TIME.test(v[1]) &&
    typeof v[2] === 'string' &&
    ACCESSION.test(v[2])
  );
}

function isFilters(v: unknown): v is CursorFilters {
  if (!isObject(v) || typeof v.t !== 'string' || !TICKERS.has(v.t)) return false;
  const dateOrNull = (d: unknown) => d === null || (typeof d === 'string' && isRealDate(d));
  const formsOk =
    v.forms === null ||
    (Array.isArray(v.forms) && v.forms.every((f) => typeof f === 'string' && FORMS.has(f)));
  return formsOk && dateOrNull(v.from) && dateOrNull(v.to);
}
