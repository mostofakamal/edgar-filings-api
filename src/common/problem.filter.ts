import {
  Catch,
  HttpException,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { AppLogger } from './logger';
import { Problem, invalidParameter } from './problem';
import { APP_LOGGER } from './tokens';

/** The parts of Express's request and response this filter uses. */
interface HttpRequest {
  method: string;
  originalUrl: string;
}
interface HttpResponse {
  status(code: number): this;
  setHeader(name: string, value: string): this;
  send(body: string): this;
}

/** Renders every error as application/problem+json (RFC 9457, spec §8). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(@Inject(APP_LOGGER) private readonly log: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<HttpRequest>();
    const res = http.getResponse<HttpResponse>();
    const instance = req.originalUrl.split('?')[0] ?? req.originalUrl;
    const problem = this.toProblem(exception, req.method, instance);

    if (problem.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(problem.retryAfterSeconds));
    }
    const body = {
      type: problem.type,
      title: problem.title,
      status: problem.status,
      detail: problem.detail,
      instance,
      ...(problem.errors ? { errors: problem.errors } : {}),
    };
    res
      .status(problem.status)
      .setHeader('Content-Type', 'application/problem+json; charset=utf-8')
      .send(JSON.stringify(body));
  }

  private toProblem(exception: unknown, method: string, path: string): Problem {
    if (exception instanceof Problem) return exception;
    if (exception instanceof HttpException && exception.getStatus() === 404) {
      return new Problem(
        404,
        '/problems/not-found',
        'Not found',
        `No route for ${method} ${path}.`,
      );
    }
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      return invalidParameter([], 'The request could not be understood.');
    }
    this.log.error({ err: exception, method, path }, 'unhandled error');
    return new Problem(
      500,
      '/problems/internal-error',
      'Internal error',
      'An internal error occurred. It has been logged.',
    );
  }
}
