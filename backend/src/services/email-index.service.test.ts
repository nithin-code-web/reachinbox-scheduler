import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailStatus } from '@prisma/client';
import type { Client } from '@elastic/elasticsearch';
import type { EmailIndexClient, EmailIndexDatabase, EmailIndexDocument } from './email-index.service.js';

const servicesPromise = (async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
  process.env.ETHEREAL_USER ??= 'test-user';
  process.env.ETHEREAL_PASSWORD ??= 'test-password';

  const indexService = await import('./email-index.service.js');
  const emailService = await import('./email.service.js');
  return { ...indexService, ...emailService };
})();

function emailDocument(id = 'email-1'): EmailIndexDocument {
  const createdAt = new Date('2026-08-29T10:00:00.000Z');

  return {
    id,
    userId: 'user-1',
    campaignId: 'campaign-1',
    senderId: 'sender-1',
    recipient: 'recipient@example.com',
    subject: 'Test subject',
    body: 'Test body',
    scheduledAt: createdAt,
    sentAt: null,
    status: EmailStatus.SCHEDULED,
    errorMessage: null,
    createdAt,
    updatedAt: createdAt,
  };
}

test('creates the email index with an explicit mapping and indexes by email ID', async () => {
  const { EMAIL_INDEX_NAME, ensureEmailIndex, indexEmailDocument } = await servicesPromise;
  let existsCalls = 0;
  let createdIndex: Record<string, unknown> | undefined;
  let indexedDocument: Record<string, unknown> | undefined;

  const client = {
    indices: {
      exists: async () => {
        existsCalls += 1;
        return false;
      },
      create: async (args: Record<string, unknown>) => {
        createdIndex = args;
      },
      putMapping: async () => undefined,
    },
    index: async (args: Record<string, unknown>) => {
      indexedDocument = args;
    },
    delete: async () => undefined,
    search: async () => ({ hits: { total: 0, hits: [] } }),
  };

  await ensureEmailIndex(client as unknown as EmailIndexClient);
  await indexEmailDocument(emailDocument(), client as unknown as EmailIndexClient);

  assert.equal(existsCalls, 1);
  assert.equal(createdIndex?.index, EMAIL_INDEX_NAME);
  assert.deepEqual(
    (createdIndex?.mappings as { properties: Record<string, unknown> }).properties.status,
    { type: 'keyword' },
  );
  assert.equal(indexedDocument?.index, EMAIL_INDEX_NAME);
  assert.equal(indexedDocument?.id, 'email-1');
  assert.equal(
    (indexedDocument?.document as EmailIndexDocument).recipient,
    'recipient@example.com',
  );
});

test('indexes the current PostgreSQL projection and removes missing records', async () => {
  const { indexEmailById } = await servicesPromise;
  const indexed: string[] = [];
  const deleted: string[] = [];
  const client = {
    indices: {
      exists: async () => true,
      create: async () => undefined,
      putMapping: async () => undefined,
    },
    index: async (args: { id: string }) => {
      indexed.push(args.id);
    },
    delete: async (args: { id: string }) => {
      deleted.push(args.id);
    },
    search: async () => ({ hits: { total: 0, hits: [] } }),
  };
  const database = {
    email: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'email-1'
          ? { ...emailDocument(), campaign: { userId: 'user-1' } }
          : null,
    },
  };

  await indexEmailById(
    'email-1',
    client as unknown as EmailIndexClient,
    database as unknown as EmailIndexDatabase,
  );
  await indexEmailById(
    'email-missing',
    client as unknown as EmailIndexClient,
    database as unknown as EmailIndexDatabase,
  );

  assert.deepEqual(indexed, ['email-1']);
  assert.deepEqual(deleted, ['email-missing']);
});

test('bounds asynchronous indexing retries when Elasticsearch is unavailable', async () => {
  const { indexEmailWithRetry } = await servicesPromise;
  let attempts = 0;
  const client = {
    indices: {
      exists: async () => true,
      create: async () => undefined,
      putMapping: async () => undefined,
    },
    index: async () => {
      attempts += 1;
      throw new Error('Elasticsearch unavailable');
    },
    delete: async () => undefined,
    search: async () => ({ hits: { total: 0, hits: [] } }),
  };
  const database = {
    email: {
      findUnique: async () => ({
        ...emailDocument(),
        campaign: { userId: 'user-1' },
      }),
    },
  };

  await assert.rejects(
    indexEmailWithRetry(
      'email-1',
      client as unknown as EmailIndexClient,
      database as unknown as EmailIndexDatabase,
      [0, 0],
    ),
    /Elasticsearch unavailable/,
  );
  assert.equal(attempts, 3);
});

test('search returns Elasticsearch IDs for PostgreSQL hydration in hit order', async () => {
  const { searchEmails } = await servicesPromise;
  let searchRequest: Record<string, unknown> | undefined;
  const client = {
    search: async (args: Record<string, unknown>) => {
      searchRequest = args;
      return {
        hits: {
          total: { value: 2, relation: 'eq' },
          hits: [{ _id: 'email-2' }, { _id: 'email-1' }],
        },
      };
    },
  };
  const database = {
    email: {
      findMany: async () => [
        { ...emailDocument('email-1'), subject: 'First' },
        { ...emailDocument('email-2'), subject: 'Second' },
      ],
    },
  };

  const result = await searchEmails(
    {
      q: 'recipient@example.com',
      userId: 'user-1',
      status: EmailStatus.SCHEDULED,
      page: 1,
      limit: 20,
    },
    database as unknown as EmailIndexDatabase,
    client as unknown as Client,
  );

  assert.deepEqual(result.items.map((email) => email.id), ['email-2', 'email-1']);
  assert.equal(result.pagination.total, 2);
  assert.equal((searchRequest?.index as string), 'reachinbox-emails-v1');
});

test('search reports Elasticsearch outages as a service-unavailable error', async () => {
  const { searchEmails } = await servicesPromise;
  const client = {
    search: async () => {
      throw new Error('Elasticsearch unavailable');
    },
  };

  await assert.rejects(
    searchEmails(
      { userId: 'user-1', page: 1, limit: 20 },
      undefined,
      client as unknown as Client,
    ),
    (error: unknown) =>
      error instanceof Error &&
      'statusCode' in error &&
      error.statusCode === 503,
  );
});
