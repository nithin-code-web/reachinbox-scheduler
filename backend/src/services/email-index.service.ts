import { EmailStatus, PrismaClient } from '@prisma/client';
import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { elasticsearchClient } from '../db/elasticsearch.js';
import { prisma } from '../db/prisma.js';

export const EMAIL_INDEX_NAME = 'reachinbox-emails-v1';

const INDEX_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const;

export type EmailIndexDatabase = Pick<PrismaClient, 'email'>;
export type EmailIndexClient = Client;

export interface EmailIndexDocument {
  id: string;
  campaignId: string;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  sentAt: Date | null;
  status: EmailStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailSearchQuery {
  q?: string | undefined;
  status?: EmailStatus | undefined;
  senderId?: string | undefined;
  campaignId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  page: number;
  limit: number;
}

export interface EmailSearchResult {
  ids: string[];
  total: number;
}

const emailIndexDefinition = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
  },
  mappings: {
    dynamic: false,
    properties: {
      id: { type: 'keyword' },
      campaignId: { type: 'keyword' },
      senderId: { type: 'keyword' },
      recipient: {
        type: 'text',
        fields: { keyword: { type: 'keyword' } },
      },
      subject: { type: 'text' },
      body: { type: 'text' },
      status: { type: 'keyword' },
      scheduledAt: { type: 'date' },
      sentAt: { type: 'date' },
      errorMessage: { type: 'text' },
      createdAt: { type: 'date' },
      updatedAt: { type: 'date' },
    },
  },
} as const;

const emailIndexSelect = {
  id: true,
  campaignId: true,
  senderId: true,
  recipient: true,
  subject: true,
  body: true,
  scheduledAt: true,
  sentAt: true,
  status: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
} as const;

function responseValue<T>(response: T | { body: T }): T {
  if (typeof response === 'object' && response !== null && 'body' in response) {
    return response.body;
  }

  return response;
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const response = error as { statusCode?: number; meta?: { statusCode?: number } };
  return response.statusCode === 404 || response.meta?.statusCode === 404;
}

function toIndexDocument(email: EmailIndexDocument): EmailIndexDocument {
  return email;
}

export async function ensureEmailIndex(
  client: EmailIndexClient = elasticsearchClient,
): Promise<void> {
  const exists = responseValue(await client.indices.exists({ index: EMAIL_INDEX_NAME }));

  if (exists) return;

  try {
    await client.indices.create({
      index: EMAIL_INDEX_NAME,
      ...emailIndexDefinition,
    });
    logger.info({ index: EMAIL_INDEX_NAME }, 'Elasticsearch email index created');
  } catch (error) {
    // Multiple backend instances may initialize concurrently. If another
    // instance won the create race, the desired end state is already met.
    const createdByAnotherInstance = await client.indices.exists({ index: EMAIL_INDEX_NAME });
    if (responseValue(createdByAnotherInstance)) return;
    throw error;
  }
}

export async function indexEmailDocument(
  email: EmailIndexDocument,
  client: EmailIndexClient = elasticsearchClient,
): Promise<void> {
  await client.index({
    index: EMAIL_INDEX_NAME,
    id: email.id,
    document: toIndexDocument(email),
    refresh: false,
  });
}

export async function deleteEmailDocument(
  emailId: string,
  client: EmailIndexClient = elasticsearchClient,
): Promise<void> {
  try {
    await client.delete({ index: EMAIL_INDEX_NAME, id: emailId, refresh: false });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

export async function indexEmailById(
  emailId: string,
  client: EmailIndexClient = elasticsearchClient,
  database: EmailIndexDatabase = prisma,
): Promise<void> {
  const email = await database.email.findUnique({
    where: { id: emailId },
    select: emailIndexSelect,
  });

  if (!email) {
    await deleteEmailDocument(emailId, client);
    return;
  }

  await indexEmailDocument(email, client);
}

export async function indexEmailWithRetry(
  emailId: string,
  client: EmailIndexClient = elasticsearchClient,
  database: EmailIndexDatabase = prisma,
  retryDelaysMs: readonly number[] = INDEX_RETRY_DELAYS_MS,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      await indexEmailById(emailId, client, database);
      return;
    } catch (error) {
      lastError = error;
      const delay = retryDelaysMs[attempt];
      if (delay === undefined) break;

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Elasticsearch indexing failed');
}

/**
 * Fire-and-forget indexing deliberately keeps Elasticsearch outside the
 * PostgreSQL/BullMQ critical path. The reconciliation pass repairs failures
 * that outlive this bounded retry window.
 */
export function queueEmailIndexUpdate(
  emailId: string,
  client: EmailIndexClient = elasticsearchClient,
  database: EmailIndexDatabase = prisma,
): void {
  void indexEmailWithRetry(emailId, client, database).catch((error) => {
    logger.warn({ err: error, emailId }, 'Asynchronous Elasticsearch email indexing failed');
  });
}

export async function reconcileEmailIndex(
  client: EmailIndexClient = elasticsearchClient,
  database: EmailIndexDatabase = prisma,
): Promise<number> {
  await ensureEmailIndex(client);

  const emails = await database.email.findMany({
    orderBy: { updatedAt: 'asc' },
    select: emailIndexSelect,
  });

  for (const email of emails) {
    await indexEmailDocument(email, client);
  }

  return emails.length;
}

export async function searchEmailIndex(
  query: EmailSearchQuery,
  client: EmailIndexClient = elasticsearchClient,
): Promise<EmailSearchResult> {
  const filters = [];

  if (query.status) filters.push({ term: { status: query.status } });
  if (query.senderId) filters.push({ term: { senderId: query.senderId } });
  if (query.campaignId) filters.push({ term: { campaignId: query.campaignId } });
  if (query.from || query.to) {
    filters.push({
      range: {
        scheduledAt: {
          ...(query.from ? { gte: query.from.toISOString() } : {}),
          ...(query.to ? { lte: query.to.toISOString() } : {}),
        },
      },
    });
  }

  const response = await client.search<EmailIndexDocument>({
    index: EMAIL_INDEX_NAME,
    from: (query.page - 1) * query.limit,
    size: query.limit,
    track_total_hits: true,
    sort: [{ createdAt: 'desc' }, { id: 'asc' }],
    query: {
      bool: {
        must: query.q
          ? [{ multi_match: { query: query.q, fields: ['recipient', 'subject', 'body'] } }]
          : [{ match_all: {} }],
        filter: filters,
      },
    },
  });

  const body = responseValue(response);
  const totalValue = body.hits.total;
  const total =
    typeof totalValue === 'number' ? totalValue : totalValue?.value ?? 0;

  return {
    ids: body.hits.hits.flatMap((hit) => (hit._id ? [hit._id] : [])),
    total,
  };
}

let reconciliationTimer: NodeJS.Timeout | undefined;
let reconciliationInFlight: Promise<void> | undefined;

function runReconciliationPass(): void {
  if (reconciliationInFlight) return;

  reconciliationInFlight = reconcileEmailIndex()
    .then((count) => {
      logger.debug({ count }, 'Elasticsearch email reconciliation completed');
    })
    .catch((error) => {
      logger.warn({ err: error }, 'Elasticsearch email reconciliation failed');
    })
    .finally(() => {
      reconciliationInFlight = undefined;
    });
}

export function startEmailIndexing(): void {
  if (reconciliationTimer) return;

  runReconciliationPass();
  reconciliationTimer = setInterval(runReconciliationPass, env.ELASTICSEARCH_RECONCILIATION_INTERVAL_MS);
  reconciliationTimer.unref?.();
  logger.info({ index: EMAIL_INDEX_NAME }, 'Elasticsearch email indexing initialized');
}

export async function closeEmailIndexing(): Promise<void> {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = undefined;
  }

  if (reconciliationInFlight) await reconciliationInFlight;
}
