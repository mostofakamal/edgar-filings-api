/**
 * Injection tokens. Classes depend on these abstractions, never on concrete
 * implementations, so any of them can be replaced (tests, a shared store later).
 */
export const APP_CONFIG = Symbol('APP_CONFIG');
export const APP_LOGGER = Symbol('APP_LOGGER');
export const SEC_CLIENT_DEPS = Symbol('SEC_CLIENT_DEPS');
export const SEC_SOURCE = Symbol('SEC_SOURCE');
export const FILINGS_STORE = Symbol('FILINGS_STORE');
export const SCHEDULER_DEPS = Symbol('SCHEDULER_DEPS');
