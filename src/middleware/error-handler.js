import { AppError } from '../modules/shared/domain/errors.js';

/**
 * Express error-handling middleware. Expected failures (AppError) map to
 * their status code with a machine-readable code; anything unexpected
 * becomes a generic 500 without leaking internals.
 */
export function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
  }

  console.error(error);
  return res.status(500).json({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
  });
}
