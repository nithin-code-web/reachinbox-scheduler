import type { RequestHandler } from 'express';
import { z } from 'zod';
import { createCampaign } from '../services/campaign.service.js';
import { AppError } from '../utils/app-error.js';

const createCampaignSchema = z.object({
  subject: z.string().trim().min(1, 'Subject must not be empty'),
  body: z.string().trim().min(1, 'Body must not be empty'),
  recipients: z
    .array(z.string().trim().email('Each recipient must be a valid email'))
    .min(1, 'At least one recipient is required'),
  senderId: z.string().uuid('Sender ID must be a valid UUID'),
  startTime: z
    .string()
    .datetime({ offset: true, message: 'Start time must be a valid ISO-8601 datetime' })
    .transform((value) => new Date(value)),
  delaySeconds: z.number().int().min(1, 'Delay must be at least 1 second'),
  hourlyLimit: z.number().int().min(1, 'Hourly limit must be at least 1'),
});

export const createCampaignController: RequestHandler = async (request, response, next) => {
  const parsedBody = createCampaignSchema.safeParse(request.body);

  if (!parsedBody.success) {
    next(new AppError('Invalid campaign request', 400));
    return;
  }

  if (!request.auth) {
    next(new AppError('Authentication required', 401));
    return;
  }

  try {
    const result = await createCampaign({ ...parsedBody.data, userId: request.auth.id });
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
};
