import { EmailStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';

const emailListSelect = {
  id: true,
  recipient: true,
  scheduledAt: true,
  sentAt: true,
  status: true,
} as const;

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
