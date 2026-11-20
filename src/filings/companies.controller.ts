import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { FilingsQueryService } from './query.service';

@Controller('v1/companies')
export class CompaniesController {
  constructor(@Inject(FilingsQueryService) private readonly query: FilingsQueryService) {}

  /** Spec §7.1 */
  @Get(':ticker')
  getCompany(@Param('ticker') ticker: string) {
    const { company, dataAsOf } = this.query.getCompany(ticker);
    return { data: company, meta: { dataAsOf } };
  }

  /** Spec §7.2 */
  @Get(':ticker/filings')
  listFilings(@Param('ticker') ticker: string, @Query() query: Record<string, unknown>) {
    const r = this.query.listCompanyFilings(ticker, query);
    return {
      data: r.data,
      page: { limit: r.limit, nextCursor: r.nextCursor },
      meta: { dataAsOf: r.dataAsOf },
    };
  }
}
