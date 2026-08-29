import assert from 'node:assert/strict';
import test from 'node:test';
import { DelayedError } from 'bullmq';
import type { EmailRescheduleDatabase } from './email-reschedule.service.js';

const servicePromise = (async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
  process.env.ETHEREAL_USER ??= 'test-user';
  process.env.ETHEREAL_PASSWORD ??= 'test-password';

  return import('./email-reschedule.service.js');
})();

function fakeJob(shouldFail = false) {
  let movedTo: number | undefined;
  return {
    token: 'test-token',
    moveToDelayed: async (timestamp: number) => {
      if (shouldFail) throw new Error('temporary Redis failure');
      movedTo = timestamp;
    },
    get movedTo() {
      return movedTo;
    },
  };
}

test('persists SCHEDULED state before moving the active BullMQ job', async () => {
  const { rescheduleEmailForNextHour } = await servicePromise;
  let updateData: unknown;
  const database = {
    email: {
      updateMany: async (args: { data: unknown }) => {
        updateData = args.data;
        return { count: 1 };
      },
    },
  };
  const job = fakeJob();
  const nextHourAt = Date.now() + 60 * 60 * 1000;

  await assert.rejects(
    rescheduleEmailForNextHour(
      job as never,
      'email-1',
      new Date(),
      nextHourAt,
      database as unknown as EmailRescheduleDatabase,
    ),
    (error: unknown) => error instanceof DelayedError,
  );

  assert.deepEqual(updateData, {
    status: 'SCHEDULED',
    processingLeaseUntil: null,
    scheduledAt: new Date(nextHourAt),
    errorMessage: null,
  });
  assert.equal(job.movedTo, nextHourAt);
});

test('keeps the durable SCHEDULED state when the BullMQ move fails', async () => {
  const { rescheduleEmailForNextHour } = await servicePromise;
  let updateCalled = false;
  const database = {
    email: {
      updateMany: async () => {
        updateCalled = true;
        return { count: 1 };
      },
    },
  };

  await assert.rejects(
    rescheduleEmailForNextHour(
      fakeJob(true) as never,
      'email-2',
      new Date(),
      Date.now() + 60 * 60 * 1000,
      database as unknown as EmailRescheduleDatabase,
    ),
    /temporary Redis failure/,
  );

  assert.equal(updateCalled, true);
});
