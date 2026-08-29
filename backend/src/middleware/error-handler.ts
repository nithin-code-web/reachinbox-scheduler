import type { ErrorRequestHandler } from 'express';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/app-error.js';

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  logger.error({ err: error }, 'Unhandled request error');

  if (error instanceof AppError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  response.status(500).json({ error: 'Internal server error' });
};
