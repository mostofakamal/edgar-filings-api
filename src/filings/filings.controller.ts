import { Controller, Get, Inject, Param } from '@nestjs/common';
import { FilingsQueryService } from './query.service';

@Controller('v1/filings')
export class FilingsController {
  constructor(@Inject(FilingsQueryService) private readonly query: FilingsQueryService) {}

  /** Spec §7.3 */
  @Get(':accessionNumber')
  getFiling(@Param('accessionNumber') accessionNumber: string) {
    const { filing, dataAsOf } = this.query.getFiling(accessionNumber);
    return { data: filing, meta: { dataAsOf } };
  }
}
