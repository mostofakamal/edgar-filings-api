import { SecError, type SecSource } from '../../src/sec/sec-client';

/** Serves fixed responses by file name; fails the test on any other request. */
export class FakeSecClient implements SecSource {
  readonly calls: string[] = [];

  constructor(private readonly files: Record<string, unknown>) {}

  getJson(fileName: string): Promise<unknown> {
    this.calls.push(fileName);
    if (!(fileName in this.files)) {
      return Promise.reject(new Error(`unexpected SEC request: ${fileName}`));
    }
    const value = this.files[fileName];
    return value instanceof SecError ? Promise.reject(value) : Promise.resolve(value);
  }
}
