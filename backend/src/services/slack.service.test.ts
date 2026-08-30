import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
process.env.ETHEREAL_USER ??= 'test-user';
process.env.ETHEREAL_PASSWORD ??= 'test-password';
process.env.SLACK_CLIENT_ID = 'slack-client-id';
process.env.SLACK_CLIENT_SECRET = 'slack-client-secret';
process.env.SLACK_REDIRECT_URI = 'http://localhost:3000/auth/slack/callback';
process.env.SLACK_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

const slackServicePromise = import('./slack.service.js');

function fakeRedis() {
  const values = new Map<string, string>();
  return {
    values,
    async set(key: string, value: string) {
      values.set(key, value);
      return 'OK';
    },
    async getdel(key: string) {
      const value = values.get(key);
      values.delete(key);
      return value ?? null;
    },
  };
}

function jsonResponse(value: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(
    JSON.stringify(value),
    headers ? { status, headers } : { status },
  );
}

test('creates a user-bound Slack OAuth state without selecting a channel', async () => {
  const { createSlackAuthorizationUrl } = await slackServicePromise;
  const redis = fakeRedis();
  const url = await createSlackAuthorizationUrl('user-1', 'b'.repeat(64), redis as never);
  const parsed = new URL(url);

  assert.equal(parsed.origin, 'https://slack.com');
  assert.equal(parsed.pathname, '/oauth/v2/authorize');
  assert.equal(parsed.searchParams.get('client_id'), 'slack-client-id');
  assert.equal(parsed.searchParams.get('redirect_uri'), 'http://localhost:3000/auth/slack/callback');
  assert.equal(parsed.searchParams.get('channel'), null);
  assert.equal(parsed.searchParams.get('scope'), 'chat:write,channels:read,groups:read');
  assert.match(parsed.searchParams.get('state') ?? '', /^[A-Za-z0-9_-]+$/);
  assert.equal(redis.values.size, 1);
});

test('rejects a Slack callback when state is bound to another user or session', async () => {
  const { createSlackAuthorizationUrl, completeSlackAuthentication } = await slackServicePromise;
  const redis = fakeRedis();
  const url = await createSlackAuthorizationUrl('user-1', 'b'.repeat(64), redis as never);
  const state = new URL(url).searchParams.get('state') as string;
  let exchangeCalled = false;
  const fetcher = async () => {
    exchangeCalled = true;
    return jsonResponse({ ok: true, access_token: 'xoxb-secret', team: { id: 'T1' } });
  };

  await assert.rejects(
    completeSlackAuthentication(
      'user-2',
      'b'.repeat(64),
      'code',
      state,
      redis as never,
      undefined,
      fetcher as never,
    ),
    (error: unknown) => error instanceof Error && 'statusCode' in error && error.statusCode === 401,
  );
  assert.equal(exchangeCalled, false);
});

test('exchanges Slack OAuth, encrypts the token, and preserves same-workspace channel selection', async () => {
  const {
    createSlackAuthorizationUrl,
    completeSlackAuthentication,
  } = await slackServicePromise;
  const redis = fakeRedis();
  const url = await createSlackAuthorizationUrl('user-1', 'b'.repeat(64), redis as never);
  const state = new URL(url).searchParams.get('state') as string;
  let upsertArgs: { create: Record<string, unknown>; update: Record<string, unknown> } | undefined;
  const database = {
    slackConnection: {
      findUnique: async () => ({ teamId: 'T1', channelId: 'C1' }),
      upsert: async (args: typeof upsertArgs) => {
        upsertArgs = args;
        return { teamId: 'T1', channelId: 'C1' };
      },
    },
  };
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'POST');
    assert.match(String(init?.body), /code=code/);
    assert.match(String(init?.body), /redirect_uri=/);
    return jsonResponse({ ok: true, access_token: 'xoxb-secret', team: { id: 'T1' } });
  };

  const result = await completeSlackAuthentication(
    'user-1',
    'b'.repeat(64),
    'code',
    state,
    redis as never,
    database as never,
    fetcher as never,
  );

  assert.deepEqual(result, { connected: true, teamId: 'T1', channelId: 'C1' });
  assert.ok(upsertArgs);
  assert.notEqual(upsertArgs.create.accessToken, 'xoxb-secret');
  assert.notEqual(upsertArgs.update.accessToken, 'xoxb-secret');
  assert.equal(upsertArgs.create.channelId, 'C1');
});

test('encrypts and decrypts Slack tokens without exposing plaintext in ciphertext', async () => {
  const { decryptSlackToken, encryptSlackToken } = await import('./slack-token.service.js');
  const encrypted = encryptSlackToken('xoxb-secret');
  assert.notEqual(encrypted, 'xoxb-secret');
  assert.equal(decryptSlackToken(encrypted), 'xoxb-secret');
  assert.throws(() => decryptSlackToken(`${encrypted.slice(0, -1)}0`));
});

test('returns safe connection data and verifies channel selection through Slack', async () => {
  const { getSlackConnection, listSlackChannels, selectSlackChannel } = await slackServicePromise;
  const { encryptSlackToken } = await import('./slack-token.service.js');
  const calls: unknown[] = [];
  const database = {
    slackConnection: {
      findUnique: async ({ where }: { where: { userId: string } }) => {
        calls.push(where);
        return {
          accessToken: encryptSlackToken('xoxb-secret'),
          teamId: 'T1',
          channelId: null,
        };
      },
      updateMany: async (args: unknown) => {
        calls.push(args);
        return { count: 1 };
      },
    },
  };
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    assert.match(String(input), /conversations\.(list|info)/);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer xoxb-secret');
    if (String(input).includes('conversations.info')) {
      assert.equal(init?.method, 'GET');
      assert.equal(init?.body, undefined);
      assert.equal(new URL(String(input)).searchParams.get('channel'), 'C1');
      return jsonResponse({ ok: true, channel: { id: 'C1', is_archived: false } });
    }

    assert.equal(init?.method, 'POST');
    return String(input).includes('conversations.list')
      ? jsonResponse({
          ok: true,
          channels: [{ id: 'C1', name: 'alerts', is_private: true }],
          response_metadata: { next_cursor: '' },
        })
      : jsonResponse({ ok: false, error: 'unexpected_method' });
  };

  assert.deepEqual(await getSlackConnection('user-1', database as never), {
    connected: true,
    teamId: 'T1',
    channelId: null,
  });
  assert.deepEqual(
    await listSlackChannels('user-1', undefined, database as never, fetcher as never),
    { channels: [{ id: 'C1', name: 'alerts', isPrivate: true }], nextCursor: null },
  );
  assert.deepEqual(
    await selectSlackChannel('user-1', 'C1', database as never, fetcher as never),
    { connected: true, teamId: 'T1', channelId: 'C1' },
  );
  assert.deepEqual(calls[0], { userId: 'user-1' });
});

test('deletes the local connection even when Slack revocation is unavailable', async () => {
  const { disconnectSlack } = await slackServicePromise;
  const { encryptSlackToken } = await import('./slack-token.service.js');
  let deleted = false;
  const database = {
    slackConnection: {
      findUnique: async () => ({
        accessToken: encryptSlackToken('xoxb-secret'),
        teamId: 'T1',
        channelId: 'C1',
      }),
      delete: async () => {
        deleted = true;
      },
    },
  };

  await disconnectSlack(
    'user-1',
    database as never,
    (async () => {
      throw new Error('Slack unavailable');
    }) as never,
  );
  assert.equal(deleted, true);
});

test.after(async () => {
  const { redisConnection } = await import('../db/redis.js');
  redisConnection.disconnect();
});
