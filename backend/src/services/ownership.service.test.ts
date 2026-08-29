import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailStatus } from '@prisma/client';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
process.env.ETHEREAL_USER ??= 'test-user';
process.env.ETHEREAL_PASSWORD ??= 'test-password';

const emailServicePromise = import('./email.service.js');

test('scheduled and sent listings apply campaign ownership filters', async () => {
  const { listScheduledEmails, listSentEmails } = await emailServicePromise;
  const wheres: unknown[] = [];
  const database = {
    email: {
      findMany: async (args: { where: unknown }) => {
        wheres.push(args.where);
        return [];
      },
    },
  };

  await listScheduledEmails('user-1', database as never);
  await listSentEmails('user-1', database as never);

  assert.deepEqual(wheres, [
    { status: EmailStatus.SCHEDULED, campaign: { userId: 'user-1' } },
    { status: EmailStatus.SENT, campaign: { userId: 'user-1' } },
  ]);
});

test('search filters Elasticsearch by user and repeats the ownership check in PostgreSQL', async () => {
  const { searchEmails } = await emailServicePromise;
  let request: Record<string, unknown> | undefined;
  let databaseWhere: unknown;
  const client = {
    search: async (args: Record<string, unknown>) => {
      request = args;
      return {
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{ _id: 'email-1' }],
        },
      };
    },
  };
  const database = {
    email: {
      findMany: async (args: { where: unknown }) => {
        databaseWhere = args.where;
        return [];
      },
    },
  };

  await searchEmails(
    { userId: 'user-1', page: 1, limit: 20 },
    database as never,
    client as never,
  );

  const query = request?.query as { bool: { filter: Array<{ term?: Record<string, string> }> } };
  assert.ok(query.bool.filter.some((filter) => filter.term?.userId === 'user-1'));
  assert.deepEqual(databaseWhere, {
    id: { in: ['email-1'] },
    campaign: { userId: 'user-1' },
  });
});
