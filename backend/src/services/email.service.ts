import { EmailStatus } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Client } from '@elastic/elasticsearch';
import { elasticsearchClient } from '../db/elasticsearch.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../utils/app-error.js';
import {
  type EmailSearchQuery,
  type EmailIndexClient,
  searchEmailIndex,
} from './email-index.service.js';

const emailListSelect = {
  id: true,
  recipient: true,
  scheduledAt: true,
  sentAt: true,
  status: true,
} as const;

const emailSearchSelect = {
  ...emailListSelect,
  subject: true,
} as const;

type EmailSearchDatabase = Pick<PrismaClient, 'email'>;
type EmailSearchClient = Client;

export async function listScheduledEmails() {
  return prisma.email.findMany({
    where: { status: EmailStatus.SCHEDULED },
    orderBy: { scheduledAt: 'asc' },
    select: emailListSelect,
  });
}

export async function listSentEmails() {
  return prisma.email.findMany({
    where: { status: EmailStatus.SENT },
    orderBy: { sentAt: 'desc' },
    select: emailListSelect,
  });
}

export async function searchEmails(
  query: EmailSearchQuery,
  database: EmailSearchDatabase = prisma,
  client: EmailSearchClient = elasticsearchClient,
) {
  let searchResult;

  try {
    searchResult = await searchEmailIndex(query, client as EmailIndexClient);
  } catch (error) {
    throw new AppError('Email search is temporarily unavailable', 503);
  }

  if (searchResult.ids.length === 0) {
    return {
      items: [],
      pagination: {
        page: query.page,
        limit: query.limit,
        total: searchResult.total,
        totalPages: Math.ceil(searchResult.total / query.limit),
      },
    };
  }

  const emails = await database.email.findMany({
    where: { id: { in: searchResult.ids } },
    select: emailSearchSelect,
  });
  const emailsById = new Map(emails.map((email) => [email.id, email]));

  return {
    items: searchResult.ids.flatMap((id) => {
      const email = emailsById.get(id);
      return email ? [email] : [];
    }),
    pagination: {
      page: query.page,
      limit: query.limit,
      total: searchResult.total,
      totalPages: Math.ceil(searchResult.total / query.limit),
    },
  };
}
