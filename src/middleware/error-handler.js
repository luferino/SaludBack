import { AppError } from '../modules/shared/domain/errors.js';

/**
 * Express error-handling middleware. Expected failures (AppError) map to
 * their status code with a machine-readable code; errors raised by
 * middleware that carry an explicit safe-to-expose HTTP status (e.g.
 * body-parser's 400 on malformed JSON) are honored; anything unexpected
 * becomes a generic 500 without leaking internals.
 */
export function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
  }

  const status = error?.statusCode ?? error?.status;
  if (typeof status === 'number' && status >= 400 && status < 600 && error.expose !== false) {
    return res.status(status).json({
      error: { code: status === 400 ? 'BAD_REQUEST' : `HTTP_${status}`, message: error.message },
    });
  }

  console.error(error);
  return res.status(500).json({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
  });
}
