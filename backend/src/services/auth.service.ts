import crypto from 'node:crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { GenerateAuthUrlOpts } from 'google-auth-library';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import { redisConnection } from '../db/redis.js';
import type { AuthenticatedUser } from '../types/auth.js';
import { createSession } from './session.service.js';
import { AppError } from '../utils/app-error.js';

const OAUTH_STATE_KEY_PREFIX = 'google-oauth-state:';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export type AuthDatabase = Pick<PrismaClient, 'user'>;

export interface GoogleOAuthClient {
  generateAuthUrl(options: GenerateAuthUrlOpts): string;
  getToken(options: { code: string; codeVerifier: string }): Promise<{
    tokens: { id_token?: string | null };
  }>;
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{
    getPayload(): GoogleTokenPayload | undefined;
  }>;
}

export interface GoogleTokenPayload {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

function requireGoogleConfiguration(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new AppError('Google authentication is not configured', 503);
  }

  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  };
}

function googleClient(): OAuth2Client {
  const configuration = requireGoogleConfiguration();
  return new OAuth2Client(
    configuration.clientId,
    configuration.clientSecret,
    configuration.redirectUri,
  );
}

function stateKey(state: string): string {
  return `${OAUTH_STATE_KEY_PREFIX}${crypto.createHash('sha256').update(state).digest('hex')}`;
}

export function createPkceChallenge(codeVerifier: string): string {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
}

export async function createGoogleAuthorizationUrl(
  redis: Redis = redisConnection,
  client: GoogleOAuthClient = googleClient(),
): Promise<string> {
  const state = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = crypto.randomBytes(64).toString('base64url');
  const codeChallenge = createPkceChallenge(codeVerifier);

  await redis.set(
    stateKey(state),
    JSON.stringify({ codeVerifier }),
    'EX',
    env.OAUTH_STATE_TTL_SECONDS,
  );

  return client.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
}

async function consumeOAuthState(
  state: string,
  redis: Redis,
): Promise<{ codeVerifier: string } | null> {
  const value = await redis.getdel(stateKey(state));
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'codeVerifier' in parsed &&
      typeof parsed.codeVerifier === 'string'
    ) {
      return { codeVerifier: parsed.codeVerifier };
    }
  } catch {
    return null;
  }

  return null;
}

export async function verifyGoogleIdentity(
  code: string,
  codeVerifier: string,
  client: GoogleOAuthClient,
): Promise<Required<Pick<GoogleTokenPayload, 'sub' | 'email'>> & {
  name: string;
  picture: string | null;
}> {
  const { clientId } = requireGoogleConfiguration();
  const tokenResponse = await client.getToken({ code, codeVerifier });
  const idToken = tokenResponse.tokens.id_token;

  if (!idToken) throw new AppError('Google authentication did not return an ID token', 401);

  const ticket = await client.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();

  if (!payload || !payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) {
    throw new AppError('Invalid Google token issuer', 401);
  }

  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(clientId)) {
    throw new AppError('Invalid Google token audience', 401);
  }

  if (!payload.sub) throw new AppError('Google token is missing a subject', 401);
  if (!payload.email) throw new AppError('Google token is missing an email', 401);
  if (payload.email_verified !== true) {
    throw new AppError('Google email address is not verified', 401);
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name?.trim() || payload.email,
    picture: payload.picture ?? null,
  };
}

export async function upsertGoogleUser(
  identity: Required<Pick<GoogleTokenPayload, 'sub' | 'email'>> & {
    name: string;
    picture: string | null;
  },
  database: AuthDatabase,
): Promise<AuthenticatedUser> {
  const existingByGoogleId = await database.user.findUnique({ where: { googleId: identity.sub } });
  if (existingByGoogleId) {
    return database.user.update({
      where: { id: existingByGoogleId.id },
      data: { email: identity.email, name: identity.name, avatarUrl: identity.picture },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });
  }

  const existingByEmail = await database.user.findUnique({ where: { email: identity.email } });
  if (existingByEmail) {
    if (existingByEmail.googleId && existingByEmail.googleId !== identity.sub) {
      throw new AppError('Google account is linked to a different user', 409);
    }

    return database.user.update({
      where: { id: existingByEmail.id },
      data: {
        googleId: identity.sub,
        name: identity.name,
        avatarUrl: identity.picture,
      },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });
  }

  return database.user.create({
    data: {
      googleId: identity.sub,
      email: identity.email,
      name: identity.name,
      avatarUrl: identity.picture,
    },
    select: { id: true, email: true, name: true, avatarUrl: true },
  });
}

export async function completeGoogleAuthentication(
  code: string,
  state: string,
  redis: Redis = redisConnection,
  client: GoogleOAuthClient = googleClient(),
  database: AuthDatabase = prisma,
): Promise<{ sessionId: string; user: AuthenticatedUser }> {
  if (!code || !state) throw new AppError('Invalid Google authentication callback', 400);

  const oauthState = await consumeOAuthState(state, redis);
  if (!oauthState) throw new AppError('Invalid or expired Google authentication state', 401);

  const identity = await verifyGoogleIdentity(code, oauthState.codeVerifier, client);
  const user = await upsertGoogleUser(identity, database);
  const sessionId = await createSession(user.id, redis);

  logger.info({ userId: user.id }, 'Google authentication completed');
  return { sessionId, user };
}
