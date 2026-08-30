import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import { redisConnection } from '../db/redis.js';
import type {
  SlackChannelResponse,
  SlackConnectionResponse,
} from '../types/slack.js';
import { AppError } from '../utils/app-error.js';
import { decryptSlackToken, encryptSlackToken } from './slack-token.service.js';

const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_API_URL = 'https://slack.com/api';
const SLACK_STATE_KEY_PREFIX = 'slack-oauth-state:';
const SLACK_SCOPES = ['chat:write', 'channels:read', 'groups:read'] as const;

export type SlackDatabase = Pick<PrismaClient, 'slackConnection'>;
export type SlackFetch = typeof fetch;

interface SlackOAuthState {
  userId: string;
  sessionHash: string;
}

interface SlackConnectionRecord {
  accessToken: string;
  teamId: string;
  channelId: string | null;
}

interface SlackApiErrorOptions {
  retryable: boolean;
  code: string;
  retryAfterMs?: number | undefined;
}

interface SlackApiRequestOptions {
  httpMethod?: 'GET' | 'POST';
}

export class SlackApiError extends Error {
  public readonly retryable: boolean;
  public readonly code: string;
  public readonly retryAfterMs: number | undefined;

  constructor(message: string, options: SlackApiErrorOptions) {
    super(message);
    this.name = 'SlackApiError';
    this.retryable = options.retryable;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
  }
}

function requireSlackConfiguration(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET || !env.SLACK_REDIRECT_URI) {
    throw new AppError('Slack integration is not configured', 503);
  }

  return {
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    redirectUri: env.SLACK_REDIRECT_URI,
  };
}

function sessionHash(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

function stateKey(state: string): string {
  return `${SLACK_STATE_KEY_PREFIX}${crypto.createHash('sha256').update(state).digest('hex')}`;
}

function safeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function slackErrorCode(body: unknown): string {
  return isRecord(body) && typeof body.error === 'string' ? body.error : 'unknown_error';
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}

async function slackApiRequest(
  method: string,
  token: string,
  body: Record<string, unknown>,
  fetcher: SlackFetch = fetch,
  options: SlackApiRequestOptions = {},
): Promise<Record<string, unknown>> {
  const httpMethod = options.httpMethod ?? 'POST';
  const url = new URL(`${SLACK_API_URL}/${method}`);
  const request: RequestInit = {
    method: httpMethod,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(env.SLACK_API_TIMEOUT_MS),
  };

  if (httpMethod === 'GET') {
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  } else {
    request.headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    };
    request.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetcher(url.toString(), request);
  } catch {
    throw new SlackApiError('Slack API request failed', {
      retryable: true,
      code: 'network_error',
    });
  }

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new SlackApiError('Slack API request failed', {
      retryable: response.status === 429 || response.status >= 500,
      code: `http_${response.status}`,
      retryAfterMs: retryAfterMs(response),
    });
  }

  if (!isRecord(parsed) || parsed.ok !== true) {
    const code = slackErrorCode(parsed);
    throw new SlackApiError('Slack API rejected the request', {
      retryable: ['ratelimited', 'internal_error', 'service_unavailable', 'timeout'].includes(code),
      code,
      retryAfterMs: retryAfterMs(response),
    });
  }

  return parsed;
}

function validateOAuthResponse(value: unknown): {
  accessToken: string;
  teamId: string;
} {
  if (!isRecord(value) || value.ok !== true) {
    throw new AppError('Slack authorization was not completed', 401);
  }

  const accessToken = safeString(value.access_token);
  const team = isRecord(value.team) ? value.team : null;
  const teamId = team ? safeString(team.id) : undefined;
  if (!accessToken || !teamId) {
    throw new AppError('Slack authorization response was invalid', 401);
  }

  return { accessToken, teamId };
}

export async function createSlackAuthorizationUrl(
  userId: string,
  applicationSessionId: string,
  redis = redisConnection,
): Promise<string> {
  const { clientId, redirectUri } = requireSlackConfiguration();
  const state = crypto.randomBytes(32).toString('base64url');
  const stateRecord: SlackOAuthState = {
    userId,
    sessionHash: sessionHash(applicationSessionId),
  };

  await redis.set(
    stateKey(state),
    JSON.stringify(stateRecord),
    'EX',
    env.OAUTH_STATE_TTL_SECONDS,
  );

  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', SLACK_SCOPES.join(','));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

async function consumeSlackOAuthState(
  state: string,
  userId: string,
  applicationSessionId: string,
  redis: typeof redisConnection,
): Promise<void> {
  const value = await redis.getdel(stateKey(state));
  if (!value) throw new AppError('Invalid or expired Slack authentication state', 401);

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppError('Invalid Slack authentication state', 401);
  }

  if (
    !isRecord(parsed) ||
    parsed.userId !== userId ||
    parsed.sessionHash !== sessionHash(applicationSessionId)
  ) {
    throw new AppError('Invalid Slack authentication state', 401);
  }
}

export async function exchangeSlackCode(
  code: string,
  fetcher: SlackFetch = fetch,
): Promise<{ accessToken: string; teamId: string }> {
  const { clientId, clientSecret, redirectUri } = requireSlackConfiguration();
  const basicCredentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  let response: Response;

  try {
    response = await fetcher(`${SLACK_API_URL}/oauth.v2.access`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicCredentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(env.SLACK_API_TIMEOUT_MS),
    });
  } catch {
    throw new AppError('Slack authorization exchange failed', 503);
  }

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  if (!response.ok) throw new AppError('Slack authorization exchange failed', 503);
  return validateOAuthResponse(parsed);
}

export async function saveSlackConnection(
  userId: string,
  accessToken: string,
  teamId: string,
  database: SlackDatabase = prisma,
): Promise<SlackConnectionResponse> {
  const existing = await database.slackConnection.findUnique({
    where: { userId },
    select: { teamId: true, channelId: true },
  });
  const channelId = existing?.teamId === teamId ? existing.channelId : null;

  const connection = await database.slackConnection.upsert({
    where: { userId },
    create: { userId, accessToken: encryptSlackToken(accessToken), teamId, channelId },
    update: { accessToken: encryptSlackToken(accessToken), teamId, channelId },
    select: { teamId: true, channelId: true },
  });

  return { connected: true, teamId: connection.teamId, channelId: connection.channelId };
}

export async function completeSlackAuthentication(
  userId: string,
  applicationSessionId: string,
  code: string,
  state: string,
  redis: typeof redisConnection = redisConnection,
  database: SlackDatabase = prisma,
  fetcher: SlackFetch = fetch,
): Promise<SlackConnectionResponse> {
  await consumeSlackOAuthState(state, userId, applicationSessionId, redis);
  const authorization = await exchangeSlackCode(code, fetcher);
  const connection = await saveSlackConnection(
    userId,
    authorization.accessToken,
    authorization.teamId,
    database,
  );
  logger.info({ userId, teamId: authorization.teamId }, 'Slack workspace connected');
  return connection;
}

async function getSlackConnectionRecord(
  userId: string,
  database: SlackDatabase,
): Promise<SlackConnectionRecord | null> {
  return database.slackConnection.findUnique({
    where: { userId },
    select: { accessToken: true, teamId: true, channelId: true },
  });
}

export async function getSlackConnection(
  userId: string,
  database: SlackDatabase = prisma,
): Promise<SlackConnectionResponse> {
  const connection = await getSlackConnectionRecord(userId, database);
  return connection
    ? { connected: true, teamId: connection.teamId, channelId: connection.channelId }
    : { connected: false, teamId: null, channelId: null };
}

function channelResponse(value: Record<string, unknown>): SlackChannelResponse[] {
  if (!Array.isArray(value.channels)) return [];

  return value.channels.flatMap((channel): SlackChannelResponse[] => {
    if (!isRecord(channel)) return [];
    const id = safeString(channel.id);
    const name = safeString(channel.name);
    if (!id || !name) return [];
    return [{ id, name, isPrivate: channel.is_private === true }];
  });
}

export async function listSlackChannels(
  userId: string,
  cursor: string | undefined,
  database: SlackDatabase = prisma,
  fetcher: SlackFetch = fetch,
): Promise<{ channels: SlackChannelResponse[]; nextCursor: string | null }> {
  const connection = await getSlackConnectionRecord(userId, database);
  if (!connection) throw new AppError('Slack is not connected', 404);

  const response = await slackApiRequest(
    'conversations.list',
    decryptSlackToken(connection.accessToken),
    {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    },
    fetcher,
  );
  const metadata = isRecord(response.response_metadata) ? response.response_metadata : null;
  const nextCursor = metadata ? safeString(metadata.next_cursor) ?? null : null;
  return { channels: channelResponse(response), nextCursor };
}

export async function selectSlackChannel(
  userId: string,
  channelId: string,
  database: SlackDatabase = prisma,
  fetcher: SlackFetch = fetch,
): Promise<SlackConnectionResponse> {
  const connection = await getSlackConnectionRecord(userId, database);
  if (!connection) throw new AppError('Slack is not connected', 404);

  const response = await slackApiRequest(
    'conversations.info',
    decryptSlackToken(connection.accessToken),
    { channel: channelId },
    fetcher,
    { httpMethod: 'GET' },
  );
  const channel = isRecord(response.channel) ? response.channel : null;
  if (!channel || channel.id !== channelId || channel.is_archived === true) {
    throw new AppError('Slack channel is not available', 400);
  }

  const updated = await database.slackConnection.updateMany({
    where: { userId },
    data: { channelId },
  });
  if (updated.count !== 1) throw new AppError('Slack connection was not found', 404);

  return { connected: true, teamId: connection.teamId, channelId };
}

export async function disconnectSlack(
  userId: string,
  database: SlackDatabase = prisma,
  fetcher: SlackFetch = fetch,
): Promise<void> {
  const connection = await getSlackConnectionRecord(userId, database);
  if (!connection) return;

  await database.slackConnection.delete({ where: { userId } });

  try {
    await slackApiRequest('auth.revoke', decryptSlackToken(connection.accessToken), {}, fetcher);
  } catch (error) {
    logger.warn(
      { userId, teamId: connection.teamId, err: error },
      'Slack local connection removed but remote token revocation failed',
    );
  }
}

export async function postSlackMessage(
  userId: string,
  text: string,
  database: SlackDatabase = prisma,
  fetcher: SlackFetch = fetch,
): Promise<boolean> {
  const connection = await getSlackConnectionRecord(userId, database);
  if (!connection || !connection.channelId) return false;

  await slackApiRequest(
    'chat.postMessage',
    decryptSlackToken(connection.accessToken),
    { channel: connection.channelId, text },
    fetcher,
  );
  return true;
}
