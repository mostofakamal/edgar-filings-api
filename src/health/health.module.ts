import { Module } from '@nestjs/common';
import { FilingsModule } from '../filings/filings.module';
import { HealthController } from './health.controller';

@Module({ imports: [FilingsModule], controllers: [HealthController] })
export class HealthModule {}
