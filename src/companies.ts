/** The six supported companies, in alphabetical ticker order ("ticker order" in the spec). */
export const COMPANIES = [
  { ticker: 'AAPL', cik: '0000320193' },
  { ticker: 'AMZN', cik: '0001018724' },
  { ticker: 'GOOGL', cik: '0001652044' },
  { ticker: 'GS', cik: '0000886982' },
  { ticker: 'META', cik: '0001326801' },
  { ticker: 'NFLX', cik: '0001065280' },
] as const;

export type Ticker = (typeof COMPANIES)[number]['ticker'];

/** Core forms: the only forms this API serves (spec §2). */
export const CORE_FORMS: readonly string[] = ['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A'];
