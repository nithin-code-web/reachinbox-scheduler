import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
process.env.ETHEREAL_USER ??= 'test-user';
process.env.ETHEREAL_PASSWORD ??= 'test-password';

const sessionServicePromise = import('./session.service.js');

test('creates, loads, and deletes an opaque Redis-backed session', async () => {
  const { createSession, loadSession, deleteSession } = await sessionServicePromise;
  const values = new Map<string, string>();
  const redis = {
    async set(key: string, value: string) {
      values.set(key, value);
      return 'OK';
    },
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async del(key: string) {
      values.delete(key);
      return 1;
    },
  };

  const sessionId = await createSession('user-1', redis as never);
  assert.match(sessionId, /^[a-f0-9]{64}$/);
  assert.deepEqual(await loadSession(sessionId, redis as never), { userId: 'user-1' });
  await deleteSession(sessionId, redis as never);
  assert.equal(await loadSession(sessionId, redis as never), null);
});

test('serializes a secure HttpOnly Lax cookie and can read it back', async () => {
  const { readSessionId, sessionCookieHeader } = await sessionServicePromise;
  const sessionId = 'a'.repeat(64);
  const header = sessionCookieHeader(sessionId);

  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
  assert.equal(readSessionId(header.split(';')[0]), sessionId);
});

test.after(async () => {
  const { redisConnection } = await import('../db/redis.js');
  redisConnection.disconnect();
});
