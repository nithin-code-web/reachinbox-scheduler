import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
process.env.ETHEREAL_USER ??= 'test-user';
process.env.ETHEREAL_PASSWORD ??= 'test-password';

const authMiddlewarePromise = import('./auth.js');

test('rejects an API request without a session cookie', async () => {
  let nextError: unknown;
  const { createRequireAuth } = await authMiddlewarePromise;
  const middleware = createRequireAuth(
    { user: { findUnique: async () => null } } as never,
    { loadSession: async () => null, deleteSession: async () => undefined },
  );

  await middleware(
    { headers: {} } as never,
    {} as never,
    (error?: unknown) => {
      nextError = error;
    },
  );

  assert.equal((nextError as { statusCode: number }).statusCode, 401);
});

test('loads the session and attaches the canonical user to the request', async () => {
  let authenticatedRequest: { auth?: { id: string } } | undefined;
  const { createRequireAuth } = await authMiddlewarePromise;
  const middleware = createRequireAuth(
    {
      user: {
        findUnique: async () => ({
          id: 'user-1',
          email: 'user@example.com',
          name: 'User',
          avatarUrl: null,
        }),
      },
    } as never,
    { loadSession: async () => ({ userId: 'user-1' }), deleteSession: async () => undefined },
  );
  const request = {
    headers: { cookie: 'reachinbox_session=' + 'a'.repeat(64) },
  } as never;

  await middleware(request, {} as never, () => {
    authenticatedRequest = request;
  });

  assert.equal(authenticatedRequest?.auth?.id, 'user-1');
});

test.after(async () => {
  const { redisConnection } = await import('../db/redis.js');
  redisConnection.disconnect();
});
