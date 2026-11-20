import { Module } from '@nestjs/common';
import { FILINGS_STORE, SCHEDULER_DEPS } from '../common/tokens';
import { SecModule } from '../sec/sec.module';
import { CompaniesController } from './companies.controller';
import { FilingsController } from './filings.controller';
import { InMemoryFilingsStore } from './filings.store';
import { Loader } from './loader';
import { FilingsQueryService } from './query.service';
import { RefreshScheduler, defaultSchedulerDeps } from './refresh.scheduler';

@Module({
  imports: [SecModule],
  controllers: [CompaniesController, FilingsController],
  providers: [
    InMemoryFilingsStore,
    { provide: FILINGS_STORE, useExisting: InMemoryFilingsStore },
    { provide: SCHEDULER_DEPS, useValue: defaultSchedulerDeps },
    Loader,
    RefreshScheduler,
    FilingsQueryService,
  ],
  exports: [FILINGS_STORE],
})
export class FilingsModule {}
