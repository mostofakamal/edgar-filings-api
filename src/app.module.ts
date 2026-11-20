import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule as PinoHttpModule } from 'nestjs-pino';
import type { Logger } from 'pino';
import { LoggerModule } from './common/logger.module';
import { ProblemFilter } from './common/problem.filter';
import { APP_LOGGER } from './common/tokens';
import { AppConfigModule } from './config/config.module';
import { FilingsModule } from './filings/filings.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    // HTTP request logs reuse the one pino logger, with a generated request ID.
    PinoHttpModule.forRootAsync({
      inject: [APP_LOGGER],
      useFactory: (logger: Logger) => ({ pinoHttp: { logger, genReqId: () => randomUUID() } }),
    }),
    FilingsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
})
export class AppModule {}
