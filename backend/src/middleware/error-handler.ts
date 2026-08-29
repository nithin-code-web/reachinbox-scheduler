import type { ErrorRequestHandler } from 'express';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/app-error.js';

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  // OAuth provider errors can contain credential or token-related details. Keep
  // auth logs deliberately metadata-only; application errors retain diagnostics.
  if (request.path.startsWith('/auth/')) {
    logger.warn(
      { path: request.path, statusCode: error instanceof AppError ? error.statusCode : 500 },
      'Authentication request failed',
    );
  } else {
    logger.error({ err: error }, 'Unhandled request error');
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  response.status(500).json({ error: 'Internal server error' });
};
