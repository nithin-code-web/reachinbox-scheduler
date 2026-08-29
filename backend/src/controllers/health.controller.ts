import type { RequestHandler } from 'express';

export const healthController: RequestHandler = (_request, response) => {
  response.status(200).json({ status: 'ok' });
};
