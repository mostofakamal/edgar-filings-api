import { compareFilings, type Filing } from './filing';

/**
 * Refresh merge (spec §9.2). `recentOldest` is R, the oldest filingDate in SEC's new
 * `recent` file. Rows dated after R come only from `fresh`, so removals there show up.
 * Old rows dated on or before R are kept unless `fresh` has the same accession.
 * When the new `recent` file has no rows (R is null) there is no evidence of removals,
 * so every old row not in `fresh` is kept.
 */
export function mergeRefresh(
  old: readonly Filing[],
  fresh: readonly Filing[],
  recentOldest: string | null,
): Filing[] {
  const freshIds = new Set(fresh.map((f) => f.accessionNumber));
  const kept = old.filter(
    (f) =>
      !freshIds.has(f.accessionNumber) && (recentOldest === null || f.filingDate <= recentOldest),
  );
  return [...fresh, ...kept].sort(compareFilings);
}
