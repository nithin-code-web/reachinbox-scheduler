import type { RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import {
  completeGoogleAuthentication,
  createGoogleAuthorizationUrl,
} from '../services/auth.service.js';
import {
  clearSessionCookieHeader,
  deleteSession,
  readSessionId,
  sessionCookieHeader,
} from '../services/session.service.js';
import { AppError } from '../utils/app-error.js';

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const startGoogleAuthController: RequestHandler = async (_request, response, next) => {
  try {
    response.redirect(await createGoogleAuthorizationUrl());
  } catch (error) {
    next(error);
  }
};

export const googleCallbackController: RequestHandler = async (request, response, next) => {
  if (typeof request.query.error === 'string') {
    next(new AppError('Google authentication was cancelled', 401));
    return;
  }

  const parsedQuery = callbackSchema.safeParse(request.query);
  if (!parsedQuery.success) {
    next(new AppError('Invalid Google authentication callback', 400));
    return;
  }

  try {
    const result = await completeGoogleAuthentication(
      parsedQuery.data.code,
      parsedQuery.data.state,
    );
    response.setHeader('Set-Cookie', sessionCookieHeader(result.sessionId));
    response.redirect(env.FRONTEND_URL);
  } catch (error) {
    next(error);
  }
};

export const logoutController: RequestHandler = async (request, response, next) => {
  try {
    const sessionId = readSessionId(request.headers.cookie);
    if (sessionId) await deleteSession(sessionId);
    response.setHeader('Set-Cookie', clearSessionCookieHeader());
    response.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
};

export const currentUserController: RequestHandler = (request, response, next) => {
  if (!request.auth) {
    next(new AppError('Authentication required', 401));
    return;
  }

  response.status(200).json({ user: request.auth });
};
