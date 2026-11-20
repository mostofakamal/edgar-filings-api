import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { AppLogger } from './common/logger';
import { APP_CONFIG, APP_LOGGER } from './common/tokens';
import { ConfigError, type AppConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, abortOnError: false });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const cfg = app.get<AppConfig>(APP_CONFIG);
  // SEC_USER_AGENT holds a contact email on purpose (SEC requires it); it is not a secret.
  app.get<AppLogger>(APP_LOGGER).info({ config: cfg }, 'starting');
  // The refresh scheduler starts from its onApplicationBootstrap hook, without blocking.
  await app.listen(cfg.port);
}

bootstrap().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
