import { mergeRefresh } from '../../src/filings/merge';
import type { Filing } from '../../src/filings/filing';

function filing(accessionNumber: string, filingDate: string, form = '8-K'): Filing {
  return {
    accessionNumber,
    ticker: 'GS',
    cik: '0000886982',
    form,
    filingDate,
    reportDate: filingDate,
    acceptanceDateTime: `${filingDate}T12:00:00Z`,
    primaryDocumentUrl: null,
  };
}

const ids = (fs: Filing[]) => fs.map((f) => f.accessionNumber);

describe('mergeRefresh (spec §9.2 worked example, R = 2025-11-27)', () => {
  const agedOut = filing('A-aged-out', '2025-11-24');
  const removed = filing('B-removed', '2026-11-19');
  const added = filing('C-added', '2026-11-20');
  const stillThere = filing('D-still-there', '2026-11-13');
  const result = mergeRefresh([removed, stillThere, agedOut], [added, stillThere], '2025-11-27');

  it('keeps a row that moved out of recent (filingDate <= R) from the old data', () => {
    expect(ids(result)).toContain('A-aged-out');
  });

  it('drops a row SEC removed from the recent window (filingDate > R)', () => {
    expect(ids(result)).not.toContain('B-removed');
  });

  it('adds a new row', () => {
    expect(ids(result)).toContain('C-added');
  });

  it('returns rows newest first, each once', () => {
    expect(ids(result)).toEqual(['C-added', 'D-still-there', 'A-aged-out']);
  });
});

describe('mergeRefresh edge cases', () => {
  it('a row whose filingDate moved across R appears once, with the fresh values', () => {
    const old = filing('X', '2025-11-20');
    const fresh = { ...filing('X', '2025-12-01'), form: '8-K/A' };
    const result = mergeRefresh([old], [fresh], '2025-11-27');
    expect(result).toEqual([fresh]);
  });

  it('rows on day R are kept from both sides without duplicates', () => {
    const oldOnly = filing('old-on-R', '2025-11-27');
    const both = filing('both-on-R', '2025-11-27');
    const freshOnly = filing('fresh-on-R', '2025-11-27');
    const result = mergeRefresh([oldOnly, both], [both, freshOnly], '2025-11-27');
    expect(ids(result).sort()).toEqual(['both-on-R', 'fresh-on-R', 'old-on-R']);
  });

  it('keeps every old row when the recent file had no rows (R is null)', () => {
    const old = [filing('Y', '2026-11-01'), filing('Z', '2024-01-01')];
    expect(ids(mergeRefresh(old, [], null))).toEqual(['Y', 'Z']);
  });
});
