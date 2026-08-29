import crypto from 'node:crypto';
import { parseCookie, stringifySetCookie } from 'cookie';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { redisConnection } from '../db/redis.js';
import type { SessionRecord } from '../types/auth.js';

const SESSION_KEY_PREFIX = 'auth-session:';

export function readSessionId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  return parseCookie(cookieHeader)[env.SESSION_COOKIE_NAME] ?? null;
}

export function sessionCookieHeader(sessionId: string): string {
  return stringifySetCookie({
    name: env.SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.SESSION_COOKIE_SECURE,
    maxAge: env.SESSION_TTL_SECONDS,
    path: '/',
  });
}

export function clearSessionCookieHeader(): string {
  return stringifySetCookie({
    name: env.SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.SESSION_COOKIE_SECURE,
    expires: new Date(0),
    maxAge: 0,
    path: '/',
  });
}

function sessionKey(sessionId: string): string {
  const digest = crypto.createHash('sha256').update(sessionId).digest('hex');
  return `${SESSION_KEY_PREFIX}${digest}`;
}

function isValidSessionId(sessionId: string): boolean {
  return /^[a-f0-9]{64}$/.test(sessionId);
}

export async function createSession(
  userId: string,
  redis: Redis = redisConnection,
): Promise<string> {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const record: SessionRecord = { userId };

  await redis.set(
    sessionKey(sessionId),
    JSON.stringify(record),
    'EX',
    env.SESSION_TTL_SECONDS,
  );

  return sessionId;
}

export async function loadSession(
  sessionId: string,
  redis: Redis = redisConnection,
): Promise<SessionRecord | null> {
  if (!isValidSessionId(sessionId)) return null;

  const value = await redis.get(sessionKey(sessionId));
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'userId' in parsed &&
      typeof parsed.userId === 'string'
    ) {
      return { userId: parsed.userId };
    }
  } catch {
    return null;
  }

  return null;
}

export async function deleteSession(
  sessionId: string,
  redis: Redis = redisConnection,
): Promise<void> {
  if (!isValidSessionId(sessionId)) return;
  await redis.del(sessionKey(sessionId));
}
