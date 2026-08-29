import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
process.env.ETHEREAL_USER ??= 'test-user';
process.env.ETHEREAL_PASSWORD ??= 'test-password';
process.env.GOOGLE_CLIENT_ID = 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback';

const authServicePromise = import('./auth.service.js');

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
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async del(key: string) {
      return values.delete(key) ? 1 : 0;
    },
  };
}

test('creates a state-bound S256 PKCE authorization request', async () => {
  const { createGoogleAuthorizationUrl, createPkceChallenge } = await authServicePromise;
  let options: Record<string, unknown> | undefined;
  const client = {
    generateAuthUrl: (value: Record<string, unknown>) => {
      options = value;
      return 'https://accounts.google.com/o/oauth2/v2/auth';
    },
  };
  const redis = fakeRedis();

  const url = await createGoogleAuthorizationUrl(redis as never, client as never);
  assert.equal(url, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(options?.code_challenge_method, 'S256');
  assert.deepEqual(options?.scope, ['openid', 'email', 'profile']);

  const stateKey = [...redis.values.keys()][0];
  assert.ok(stateKey);
  const state = options?.state as string;
  const saved = JSON.parse(redis.values.get(stateKey) as string) as { codeVerifier: string };
  assert.match(state, /^[A-Za-z0-9_-]+$/);
  assert.equal(options?.code_challenge, createPkceChallenge(saved.codeVerifier));
});

test('rejects a callback with an unknown or replayed OAuth state', async () => {
  const { completeGoogleAuthentication } = await authServicePromise;
  const client = {
    getToken: async () => {
      throw new Error('token exchange must not run');
    },
    verifyIdToken: async () => {
      throw new Error('token verification must not run');
    },
  };

  await assert.rejects(
    completeGoogleAuthentication('code', 'unknown-state', fakeRedis() as never, client as never),
    (error: unknown) => error instanceof Error && 'statusCode' in error && error.statusCode === 401,
  );
});

test('verifies Google claims and upserts a verified user before creating a session', async () => {
  const { completeGoogleAuthentication } = await authServicePromise;
  const redis = fakeRedis();
  const state = 'known-state';
  const codeVerifier = 'known-verifier';
  const stateKey = `google-oauth-state:${(await import('node:crypto')).createHash('sha256').update(state).digest('hex')}`;
  redis.values.set(stateKey, JSON.stringify({ codeVerifier }));

  let exchangedVerifier: string | undefined;
  const client = {
    getToken: async ({ code, codeVerifier: verifier }: { code: string; codeVerifier: string }) => {
      assert.equal(code, 'google-code');
      exchangedVerifier = verifier;
      return { tokens: { id_token: 'signed-id-token' } };
    },
    verifyIdToken: async ({ idToken, audience }: { idToken: string; audience: string }) => {
      assert.equal(idToken, 'signed-id-token');
      assert.equal(audience, 'test-google-client');
      return {
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: 'test-google-client',
          sub: 'google-subject-1',
          email: 'User@Example.com',
          email_verified: true,
          name: 'Google User',
          picture: 'https://example.com/avatar.png',
        }),
      };
    },
  };
  let createdUser = false;
  const database = {
    user: {
      findUnique: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        createdUser = true;
        assert.equal(args.data.email, 'user@example.com');
        return {
          id: 'user-1',
          email: 'user@example.com',
          name: 'Google User',
          avatarUrl: 'https://example.com/avatar.png',
        };
      },
      update: async () => {
        throw new Error('update must not run for a new user');
      },
    },
  };

  const result = await completeGoogleAuthentication(
    'google-code',
    state,
    redis as never,
    client as never,
    database as never,
  );

  assert.equal(exchangedVerifier, codeVerifier);
  assert.equal(createdUser, true);
  assert.equal(result.user.id, 'user-1');
  assert.match(result.sessionId, /^[a-f0-9]{64}$/);
  assert.ok([...redis.values.values()].some((value) => value.includes('user-1')));
});

test('rejects unverified Google email claims', async () => {
  const { verifyGoogleIdentity } = await authServicePromise;
  const client = {
    getToken: async () => ({ tokens: { id_token: 'id-token' } }),
    verifyIdToken: async () => ({
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        aud: 'test-google-client',
        sub: 'subject',
        email: 'user@example.com',
        email_verified: false,
      }),
    }),
  };

  await assert.rejects(
    verifyGoogleIdentity('code', 'verifier', client as never),
    (error: unknown) => error instanceof Error && 'statusCode' in error && error.statusCode === 401,
  );
});

test('links a verified Google subject to an existing local user by email', async () => {
  const { upsertGoogleUser } = await authServicePromise;
  let updateData: Record<string, unknown> | undefined;
  const database = {
    user: {
      findUnique: async ({ where }: { where: { googleId?: string; email?: string } }) =>
        where.googleId
          ? null
          : { id: 'local-user', googleId: null, email: 'user@example.com' },
      update: async (args: { data: Record<string, unknown> }) => {
        updateData = args.data;
        return {
          id: 'local-user',
          email: 'user@example.com',
          name: 'Google User',
          avatarUrl: null,
        };
      },
      create: async () => {
        throw new Error('create must not run for an existing email');
      },
    },
  };

  const user = await upsertGoogleUser(
    {
      sub: 'google-subject-2',
      email: 'user@example.com',
      name: 'Google User',
      picture: null,
    },
    database as never,
  );

  assert.equal(user.id, 'local-user');
  assert.equal(updateData?.googleId, 'google-subject-2');
});

test.after(async () => {
  const { redisConnection } = await import('../db/redis.js');
  redisConnection.disconnect();
});
