import { Global, Module } from '@nestjs/common';
import pino from 'pino';
import type { AppConfig } from '../config/config';
import { APP_CONFIG, APP_LOGGER } from './tokens';

/** Provides one pino logger (JSON lines on stdout) as the AppLogger for our classes. */
@Global()
@Module({
  providers: [
    {
      provide: APP_LOGGER,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => pino({ level: cfg.logLevel }),
    },
  ],
  exports: [APP_LOGGER],
})
export class LoggerModule {}
