import { Controller, Get, Inject, Res } from '@nestjs/common';
import { FILINGS_STORE } from '../common/tokens';
import { isReady, type FilingsStore } from '../filings/filings.store';

/** Spec §7.4. Not versioned: for infrastructure, not customers. */
@Controller('health')
export class HealthController {
  constructor(@Inject(FILINGS_STORE) private readonly store: FilingsStore) {}

  @Get('live')
  live() {
    return { status: 'live' };
  }

  @Get('ready')
  ready(@Res({ passthrough: true }) res: { status(code: number): unknown }) {
    const state = this.store.get();
    const ready = isReady(state);
    res.status(ready ? 200 : 503);
    const companies = Object.fromEntries(
      [...state.companies].map(([ticker, c]) => [
        ticker,
        { status: c.status, dataAsOf: c.dataAsOf, lastError: c.lastError },
      ]),
    );
    return { status: ready ? 'ready' : 'loading', companies };
  }
}
