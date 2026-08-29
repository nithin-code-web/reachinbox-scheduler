import type { RequestHandler } from 'express';
import { EmailStatus } from '@prisma/client';
import { z } from 'zod';
import { listScheduledEmails, listSentEmails, searchEmails } from '../services/email.service.js';
import { AppError } from '../utils/app-error.js';

const emailSearchSchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: z.enum(EmailStatus).optional(),
  senderId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  from: z
    .string()
    .datetime({ offset: true, message: 'from must be a valid ISO-8601 datetime' })
    .transform((value) => new Date(value))
    .optional(),
  to: z
    .string()
    .datetime({ offset: true, message: 'to must be a valid ISO-8601 datetime' })
    .transform((value) => new Date(value))
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

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

export const searchEmailsController: RequestHandler = async (request, response, next) => {
  const parsedQuery = emailSearchSchema.safeParse(request.query);

  if (!parsedQuery.success) {
    next(new AppError('Invalid email search query', 400));
    return;
  }

  try {
    response.status(200).json(await searchEmails(parsedQuery.data));
  } catch (error) {
    next(error);
  }
};
