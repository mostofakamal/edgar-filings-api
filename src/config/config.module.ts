import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../common/tokens';
import { loadConfig } from './config';

/** Provides the checked AppConfig, read once from process.env. */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
