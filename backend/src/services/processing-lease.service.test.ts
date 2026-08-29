import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { EmailStatus } from '@prisma/client';
import type { ProcessingLeaseDatabase } from './processing-lease.service.js';

type LeaseCondition = {
  status?: EmailStatus;
  processingLeaseUntil?: Date | null | { lte: Date };
};

type LeaseUpdateArgs = {
  where: {
    id: string;
    status?: EmailStatus;
    processingLeaseUntil?: Date;
    OR?: LeaseCondition[];
  };
  data: {
    status?: EmailStatus;
    processingLeaseUntil: Date | null;
  };
};

const leasePromise = (async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
  process.env.ETHEREAL_USER ??= 'test-user';
  process.env.ETHEREAL_PASSWORD ??= 'test-password';
  process.env.PROCESSING_LEASE_MS ??= '60000';

  return import('./processing-lease.service.js');
})();

function fakeDatabase(state: {
  id: string;
  status: EmailStatus;
  processingLeaseUntil: Date | null;
}) {
  return {
    email: {
      updateMany: async ({ where, data }: LeaseUpdateArgs) => {
        if (where.id !== state.id || where.status && where.status !== state.status) {
          return { count: 0 };
        }

        if (where.processingLeaseUntil) {
          if (
            !state.processingLeaseUntil ||
            state.processingLeaseUntil.getTime() !== where.processingLeaseUntil.getTime()
          ) {
            return { count: 0 };
          }
        }

        if (where.OR) {
          const matches = where.OR.some((condition) => {
            if (condition.status && condition.status !== state.status) return false;
            if (condition.processingLeaseUntil === null) {
              return state.processingLeaseUntil === null;
            }
            if (
              typeof condition.processingLeaseUntil === 'object' &&
              'lte' in condition.processingLeaseUntil
            ) {
              return (
                state.processingLeaseUntil !== null &&
                state.processingLeaseUntil.getTime() <= condition.processingLeaseUntil.lte.getTime()
              );
            }
            return true;
          });
          if (!matches) return { count: 0 };
        }

        state.status = data.status ?? state.status;
        state.processingLeaseUntil = data.processingLeaseUntil;
        return { count: 1 };
      },
    },
  };
}

test('claims scheduled emails and reclaims expired processing leases', async () => {
  const { claimProcessingLease } = await leasePromise;
  const emailId = crypto.randomUUID();
  const state = {
    id: emailId,
    status: EmailStatus.SCHEDULED,
    processingLeaseUntil: null as Date | null,
  };
  const database = fakeDatabase(state);
  const initialNow = new Date('2026-08-29T10:00:00.000Z');

  const firstLease = await claimProcessingLease(
    emailId,
    database as unknown as ProcessingLeaseDatabase,
    initialNow,
  );
  assert.ok(firstLease);
  assert.equal(state.status, EmailStatus.PROCESSING);

  const activeClaim = await claimProcessingLease(
    emailId,
    database as unknown as ProcessingLeaseDatabase,
    new Date(initialNow.getTime() + 1_000),
  );
  assert.equal(activeClaim, null);

  const reclaimed = await claimProcessingLease(
    emailId,
    database as unknown as ProcessingLeaseDatabase,
    new Date(firstLease.getTime() + 1),
  );
  assert.ok(reclaimed);
  assert.ok(reclaimed.getTime() > firstLease.getTime());
});

test('only one concurrent claim can win', async () => {
  const { claimProcessingLease } = await leasePromise;
  const emailId = crypto.randomUUID();
  const state = {
    id: emailId,
    status: EmailStatus.SCHEDULED,
    processingLeaseUntil: null as Date | null,
  };
  const database = fakeDatabase(state);
  const now = new Date('2026-08-29T10:00:00.000Z');

  const claims = await Promise.all([
    claimProcessingLease(emailId, database as never, now),
    claimProcessingLease(emailId, database as never, now),
  ]);

  assert.equal(claims.filter(Boolean).length, 1);
});
