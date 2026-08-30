import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../modules/shared/domain/errors.js';

interface HttpError extends Error {
  statusCode?: number;
  status?: number;
  expose?: boolean;
}

/**
 * Express error-handling middleware. Expected failures (AppError) map to
 * their status code with a machine-readable code; errors raised by
 * middleware that carry an explicit safe-to-expose HTTP status (e.g.
 * body-parser's 400 on malformed JSON) are honored; anything unexpected
 * becomes a generic 500 without leaking internals.
 */
export function errorHandler(error: HttpError, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  const status = error?.statusCode ?? error?.status;
  if (typeof status === 'number' && status >= 400 && status < 600 && error.expose !== false) {
    res.status(status).json({
      error: { code: status === 400 ? 'BAD_REQUEST' : `HTTP_${status}`, message: error.message },
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
  });
}
