import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

const servicesPromise = (async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
  process.env.ETHEREAL_USER ??= 'test-user';
  process.env.ETHEREAL_PASSWORD ??= 'test-password';

  const { redisConnection } = await import('../db/redis.js');
  const rateLimit = await import('./rate-limit.service.js');

  let redisAvailable = true;
  try {
    await redisConnection.ping();
  } catch {
    redisAvailable = false;
  }

  return { redisConnection, redisAvailable, ...rateLimit };
})();

async function cleanupSender(senderId: string): Promise<void> {
  const { redisConnection, rateLimitKeys } = await servicesPromise;
  await redisConnection.del(
    rateLimitKeys.rateLimitKey(senderId),
    rateLimitKeys.sendSpacingKey(senderId),
    rateLimitKeys.sendStartLockKey(senderId),
  );
}

function id(): string {
  return crypto.randomUUID();
}

test('reserves hourly slots under and at the configured limit', async (t) => {
  const { redisAvailable, reserveHourlySlot } = await servicesPromise;
  if (!redisAvailable) {
    t.skip('Redis is unavailable for rate-limit tests');
    return;
  }

  const senderId = id();
  try {
    const first = await reserveHourlySlot(senderId, id(), id(), 2);
    const second = await reserveHourlySlot(senderId, id(), id(), 2);

    assert.equal(first.allowed, true);
    assert.equal(first.count, 1);
    assert.equal(second.allowed, true);
    assert.equal(second.count, 2);
  } finally {
    await cleanupSender(senderId);
  }
});

test('rejects reservations over the hourly limit and returns the next hour', async (t) => {
  const { redisAvailable, reserveHourlySlot, nextUtcHourBoundary } = await servicesPromise;
  if (!redisAvailable) {
    t.skip('Redis is unavailable for rate-limit tests');
    return;
  }

  const senderId = id();
  try {
    await reserveHourlySlot(senderId, id(), id(), 2);
    await reserveHourlySlot(senderId, id(), id(), 2);
    const third = await reserveHourlySlot(senderId, id(), id(), 2);

    assert.equal(third.allowed, false);
    assert.equal(third.count, 2);
    assert.equal(third.nextHourAt, nextUtcHourBoundary(third.hourStart));
    assert.ok(third.nextHourAt > Date.now());
  } finally {
    await cleanupSender(senderId);
  }
});

test('atomically limits concurrent reservations', async (t) => {
  const { redisAvailable, reserveHourlySlot } = await servicesPromise;
  if (!redisAvailable) {
    t.skip('Redis is unavailable for rate-limit tests');
    return;
  }

  const senderId = id();
  const campaignId = id();
  try {
    const reservations = await Promise.all(
      Array.from({ length: 10 }, () => reserveHourlySlot(senderId, campaignId, id(), 3)),
    );

    assert.equal(reservations.filter((reservation) => reservation.allowed).length, 3);
    assert.equal(reservations.filter((reservation) => !reservation.allowed).length, 7);
  } finally {
    await cleanupSender(senderId);
  }
});

test('uses the lowest participating campaign limit regardless of reservation order', async (t) => {
  const { redisAvailable, reserveHourlySlotAt } = await servicesPromise;
  if (!redisAvailable) {
    t.skip('Redis is unavailable for rate-limit tests');
    return;
  }

  const now = Date.now();
  const senderHighFirst = id();
  const senderLowFirst = id();
  try {
    const highFirst = await reserveHourlySlotAt(
      senderHighFirst,
      id(),
      id(),
      5,
      now,
    );
    const lowSecond = await reserveHourlySlotAt(
      senderHighFirst,
      id(),
      id(),
      2,
      now,
    );
    const highThird = await reserveHourlySlotAt(
      senderHighFirst,
      id(),
      id(),
      5,
      now,
    );

    assert.equal(highFirst.effectiveLimit, 5);
    assert.equal(lowSecond.effectiveLimit, 2);
    assert.equal(highThird.allowed, false);
    assert.equal(highThird.effectiveLimit, 2);

    const lowFirst = await reserveHourlySlotAt(senderLowFirst, id(), id(), 2, now);
    const highSecond = await reserveHourlySlotAt(senderLowFirst, id(), id(), 5, now);
    assert.equal(lowFirst.allowed, true);
    assert.equal(highSecond.effectiveLimit, 2);
  } finally {
    await cleanupSender(senderHighFirst);
    await cleanupSender(senderLowFirst);
  }
});

test('moves a reservation to the current bucket when spacing crosses an hour boundary', async (t) => {
  const { redisAvailable, reserveHourlySlotAt, revalidateHourlySlotAt, utcHourWindow } =
    await servicesPromise;
  if (!redisAvailable) {
    t.skip('Redis is unavailable for rate-limit tests');
    return;
  }

  const senderId = id();
  const currentHourStart = utcHourWindow(Date.now()).hourStart;
  const nearBoundary = currentHourStart + 60 * 60 * 1000 - 10;
  const afterBoundary = currentHourStart + 60 * 60 * 1000 + 10;
  try {
    const initial = await reserveHourlySlotAt(senderId, id(), id(), 2, nearBoundary);
    const revalidated = await revalidateHourlySlotAt(
      senderId,
      id(),
      initial,
      2,
      afterBoundary,
    );

    assert.equal(initial.hourStart, currentHourStart);
    assert.equal(revalidated.allowed, true);
    assert.equal(revalidated.hourStart, afterBoundary - 10);
    assert.equal(revalidated.count, 1);
  } finally {
    await cleanupSender(senderId);
  }
});

test('keeps current-hour and next-hour counters separate', async (t) => {
  const { redisAvailable, reserveHourlySlotAt, utcHourWindow } = await servicesPromise;
  if (!redisAvailable) {
    t.skip('Redis is unavailable for rate-limit tests');
    return;
  }

  const senderId = id();
  const current = Date.now();
  const currentHour = utcHourWindow(current).hourStart;
  const nextHour = currentHour + 60 * 60 * 1000;
  try {
    const currentReservation = await reserveHourlySlotAt(senderId, id(), id(), 1, current);
    const nextReservation = await reserveHourlySlotAt(senderId, id(), id(), 1, nextHour + 1);

    assert.equal(currentReservation.hourStart, currentHour);
    assert.equal(currentReservation.count, 1);
    assert.equal(nextReservation.hourStart, nextHour);
    assert.equal(nextReservation.count, 1);
    assert.equal(nextReservation.allowed, true);
  } finally {
    await cleanupSender(senderId);
  }
});

test('coordinates send-start reservations with a short Redis gate', async (t) => {
  const { redisAvailable, acquireSendStartSlot, releaseSendStartSlot } = await servicesPromise;
  if (!redisAvailable) {
    t.skip('Redis is unavailable for rate-limit tests');
    return;
  }

  const senderId = id();
  try {
    const first = await acquireSendStartSlot(senderId, 25, 1_000);
    assert.equal(first.acquired, true);

    const second = await acquireSendStartSlot(senderId, 25, 1_000);
    assert.equal(second.acquired, false);
    assert.ok(second.retryAt >= first.reservedUntil);

    await releaseSendStartSlot(senderId, first, false);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const third = await acquireSendStartSlot(senderId, 25, 1_000);
    assert.equal(third.acquired, true);
    await releaseSendStartSlot(senderId, third, false);
  } finally {
    await cleanupSender(senderId);
  }
});

test('calculates the next UTC hour boundary', async () => {
  const { nextUtcHourBoundary } = await servicesPromise;
  const timestamp = Date.UTC(2026, 0, 15, 14, 37, 12, 500);
  assert.equal(nextUtcHourBoundary(timestamp), Date.UTC(2026, 0, 15, 15, 0, 0));
});

test.after(async () => {
  const { redisConnection } = await servicesPromise;
  redisConnection.disconnect();
});
