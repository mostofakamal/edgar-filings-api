/** The logging surface our own classes use; satisfied by pino and by test spies. */
export interface AppLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}
