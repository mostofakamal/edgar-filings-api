import { decodeCursor, encodeCursor } from '../../src/filings/cursor';
import { Problem } from '../../src/common/problem';

const SPEC_CURSOR =
  'eyJ2IjoxLCJrIjpbIjIwMjYtMDctMzEiLCIyMDI2LTA3LTMxVDEwOjAxOjAyWiIsIjAwMDAzMjAxOTMtMjYtMDAwMDIwIl0sImYiOnsidCI6IkFBUEwiLCJmb3JtcyI6WyIxMC1LIiwiMTAtUSJdLCJmcm9tIjpudWxsLCJ0byI6bnVsbH19';
const K: [string, string, string] = ['2026-07-31', '2026-07-31T10:01:02Z', '0000320193-26-000020'];
const F = { t: 'AAPL' as const, forms: ['10-K', '10-Q'], from: null, to: null };

const b64 = (s: string) => Buffer.from(s).toString('base64url');

function cursorProblem(s: string): Problem {
  try {
    decodeCursor(s);
  } catch (e) {
    if (e instanceof Problem) return e;
    throw e;
  }
  throw new Error('expected decodeCursor to throw');
}

describe('cursor', () => {
  it('matches the spec §7.2 example string exactly', () => {
    expect(encodeCursor(K, F)).toBe(SPEC_CURSOR);
  });

  it('round trips', () => {
    expect(decodeCursor(encodeCursor(K, F))).toEqual({ k: K, f: F });
    const f2 = { t: 'GS' as const, forms: null, from: '2022-01-01', to: '2022-12-31' };
    expect(decodeCursor(encodeCursor(K, f2))).toEqual({ k: K, f: f2 });
  });

  it.each([
    ['bad base64', '***'],
    ['bad JSON', b64('{not json')],
    ['not an object', b64('[1,2]')],
    ['v != 1', b64(JSON.stringify({ v: 2, k: K, f: F }))],
    ['k too short', b64(JSON.stringify({ v: 1, k: K.slice(0, 2), f: F }))],
    ['k bad date', b64(JSON.stringify({ v: 1, k: ['2026-02-30', K[1], K[2]], f: F }))],
    ['k bad date-time', b64(JSON.stringify({ v: 1, k: [K[0], '2026-07-31 10:01', K[2]], f: F }))],
    ['k bad accession', b64(JSON.stringify({ v: 1, k: [K[0], K[1], 'x'], f: F }))],
    ['f bad ticker', b64(JSON.stringify({ v: 1, k: K, f: { ...F, t: 'GOOG' } }))],
    ['f bad form', b64(JSON.stringify({ v: 1, k: K, f: { ...F, forms: ['4'] } }))],
    ['f bad date', b64(JSON.stringify({ v: 1, k: K, f: { ...F, from: '2021-1-1' } }))],
    ['f missing', b64(JSON.stringify({ v: 1, k: K }))],
  ])('rejects %s with 400 invalid-cursor', (_name, s) => {
    expect(cursorProblem(s)).toMatchObject({ status: 400, type: '/problems/invalid-cursor' });
  });
});
