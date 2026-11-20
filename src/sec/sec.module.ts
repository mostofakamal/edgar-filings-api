import { Module } from '@nestjs/common';
import { SEC_CLIENT_DEPS, SEC_SOURCE } from '../common/tokens';
import { SecClient, type SecClientDeps } from './sec-client';

export const defaultSecClientDeps: SecClientDeps = {
  fetch: (input, init) => globalThis.fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  random: () => Math.random(),
};

/** Exposes SEC access only through the SecSource abstraction. */
@Module({
  providers: [
    { provide: SEC_CLIENT_DEPS, useValue: defaultSecClientDeps },
    SecClient,
    { provide: SEC_SOURCE, useExisting: SecClient },
  ],
  exports: [SEC_SOURCE],
})
export class SecModule {}
