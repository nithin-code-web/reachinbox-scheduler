import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';
import { prisma } from '../db/prisma.js';
import { loadSession, readSessionId, deleteSession } from '../services/session.service.js';

type AuthDatabase = Pick<typeof prisma, 'user'>;

export function createRequireAuth(
  database: AuthDatabase = prisma,
  sessionStore = { loadSession, deleteSession },
): RequestHandler {
  return async (request, _response, next) => {
    const sessionId = readSessionId(request.headers.cookie);
    if (!sessionId) {
      next(new AppError('Authentication required', 401));
      return;
    }

    try {
      const session = await sessionStore.loadSession(sessionId);
      if (!session) {
        next(new AppError('Authentication required', 401));
        return;
      }

      const user = await database.user.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true, name: true, avatarUrl: true },
      });

      if (!user) {
        await sessionStore.deleteSession(sessionId);
        next(new AppError('Authentication required', 401));
        return;
      }

      request.auth = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAuth = createRequireAuth();
