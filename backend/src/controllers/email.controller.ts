import type { RequestHandler } from 'express';
import { listScheduledEmails, listSentEmails } from '../services/email.service.js';

export const listScheduledEmailsController: RequestHandler = async (_request, response, next) => {
  try {
    response.status(200).json(await listScheduledEmails());
  } catch (error) {
    next(error);
  }
};

export const listSentEmailsController: RequestHandler = async (_request, response, next) => {
  try {
    response.status(200).json(await listSentEmails());
  } catch (error) {
    next(error);
  }
};
