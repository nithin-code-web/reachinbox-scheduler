import type { RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import {
  completeSlackAuthentication,
  createSlackAuthorizationUrl,
  disconnectSlack,
  getSlackConnection,
  listSlackChannels,
  selectSlackChannel,
} from '../services/slack.service.js';
import { readSessionId } from '../services/session.service.js';
import { AppError } from '../utils/app-error.js';

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const channelSchema = z.object({
  channelId: z.string().trim().min(1).max(100),
});

function authenticatedUserId(request: Parameters<RequestHandler>[0]): string {
  if (!request.auth) throw new AppError('Authentication required', 401);
  return request.auth.id;
}

export const startSlackAuthController: RequestHandler = async (request, response, next) => {
  try {
    const sessionId = readSessionId(request.headers.cookie);
    if (!sessionId) throw new AppError('Authentication required', 401);

    const url = await createSlackAuthorizationUrl(
      authenticatedUserId(request),
      sessionId,
    );
    response.redirect(url);
  } catch (error) {
    next(error);
  }
};

export const slackCallbackController: RequestHandler = async (request, response, next) => {
  if (typeof request.query.error === 'string') {
    next(new AppError('Slack authentication was cancelled', 401));
    return;
  }

  const parsedQuery = callbackSchema.safeParse(request.query);
  if (!parsedQuery.success) {
    next(new AppError('Invalid Slack authentication callback', 400));
    return;
  }

  try {
    const sessionId = readSessionId(request.headers.cookie);
    if (!sessionId) throw new AppError('Authentication required', 401);

    await completeSlackAuthentication(
      authenticatedUserId(request),
      sessionId,
      parsedQuery.data.code,
      parsedQuery.data.state,
    );
    response.redirect(env.FRONTEND_URL);
  } catch (error) {
    next(error);
  }
};

export const getSlackConnectionController: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json(await getSlackConnection(authenticatedUserId(request)));
  } catch (error) {
    next(error);
  }
};

export const listSlackChannelsController: RequestHandler = async (request, response, next) => {
  try {
    const cursor = typeof request.query.cursor === 'string' ? request.query.cursor : undefined;
    response.status(200).json(
      await listSlackChannels(authenticatedUserId(request), cursor),
    );
  } catch (error) {
    next(error);
  }
};

export const selectSlackChannelController: RequestHandler = async (request, response, next) => {
  const parsedBody = channelSchema.safeParse(request.body);
  if (!parsedBody.success) {
    next(new AppError('Invalid Slack channel', 400));
    return;
  }

  try {
    response.status(200).json(
      await selectSlackChannel(authenticatedUserId(request), parsedBody.data.channelId),
    );
  } catch (error) {
    next(error);
  }
};

export const disconnectSlackController: RequestHandler = async (request, response, next) => {
  try {
    await disconnectSlack(authenticatedUserId(request));
    response.status(200).json({ connected: false, teamId: null, channelId: null });
  } catch (error) {
    next(error);
  }
};
