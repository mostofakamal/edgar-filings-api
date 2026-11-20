import { COMPANIES, CORE_FORMS } from '../companies';

export interface ParameterError {
  parameter: string;
  detail: string;
}

/** An RFC 9457 problem (spec §8). Thrown by domain code; the HTTP filter renders it. */
export class Problem extends Error {
  override name = 'Problem';
  constructor(
    readonly status: number,
    readonly type: string,
    readonly title: string,
    readonly detail: string,
    readonly errors?: ParameterError[],
    readonly retryAfterSeconds?: number,
  ) {
    super(detail);
  }
}

const TICKERS = COMPANIES.map((c) => c.ticker).join(', ');
const FORMS = CORE_FORMS.join(', ');

export const supportedFormsText = `Supported forms: ${FORMS}.`;

export const invalidParameter = (
  errors: ParameterError[],
  detail = 'One or more query parameters are invalid.',
) => new Problem(400, '/problems/invalid-parameter', 'Invalid request parameter', detail, errors);

export const invalidCursor = (detail: string) =>
  new Problem(400, '/problems/invalid-cursor', 'Invalid cursor', detail);

export const dateOutOfRange = (detail: string) =>
  new Problem(400, '/problems/date-out-of-range', 'Date out of range', detail);

export const companyNotFound = (ticker: string) =>
  new Problem(
    404,
    '/problems/company-not-found',
    'Company not found',
    `Ticker '${ticker.slice(0, 20)}' is not supported. Supported tickers: ${TICKERS}.`,
  );

export const filingNotFound = (accession: string, filingsSince: string) =>
  new Problem(
    404,
    '/problems/filing-not-found',
    'Filing not found',
    `No filing with accession number ${accession}. Only core forms (${FORMS}) filed since ${filingsSince} are available.`,
  );

export const dataUnavailable = (detail: string, retryAfterSeconds: number) =>
  new Problem(
    503,
    '/problems/data-unavailable',
    'Data unavailable',
    detail,
    undefined,
    retryAfterSeconds,
  );
