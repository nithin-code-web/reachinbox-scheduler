import { EmailStatus, PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';

export type ProcessingLeaseDatabase = Pick<PrismaClient, 'email'>;

export class ProcessingLeaseLostError extends Error {
  constructor(emailId: string) {
    super(`Processing lease lost for email: ${emailId}`);
    this.name = 'ProcessingLeaseLostError';
  }
}

export function processingLeaseExpiry(
  now: Date = new Date(),
  leaseMs: number = env.PROCESSING_LEASE_MS,
): Date {
  return new Date(now.getTime() + leaseMs);
}

/**
 * Claims a scheduled email or atomically reclaims an expired processing lease.
 * The lease timestamp is also used as an optimistic ownership token by later
 * state updates, so a stale worker cannot overwrite a newer owner.
 * If a process remains alive but cannot renew its lease, an expired lease can
 * be reclaimed; an SMTP operation already in flight remains an inherently
 * ambiguous delivery window.
 */
export async function claimProcessingLease(
  emailId: string,
  database: ProcessingLeaseDatabase = prisma,
  now: Date = new Date(),
): Promise<Date | null> {
  const leaseUntil = processingLeaseExpiry(now);
  const claim = await database.email.updateMany({
    where: {
      id: emailId,
      OR: [
        { status: EmailStatus.SCHEDULED },
        {
          status: EmailStatus.PROCESSING,
          processingLeaseUntil: null,
        },
        {
          status: EmailStatus.PROCESSING,
          processingLeaseUntil: { lte: now },
        },
      ],
    },
    data: {
      status: EmailStatus.PROCESSING,
      processingLeaseUntil: leaseUntil,
    },
  });

  return claim.count === 1 ? leaseUntil : null;
}

/**
 * Renews an owned lease and returns the new ownership token. A failed update
 * means another worker has reclaimed the email or the record no longer exists.
 */
export async function renewProcessingLease(
  emailId: string,
  currentLeaseUntil: Date,
  database: ProcessingLeaseDatabase = prisma,
  now: Date = new Date(),
): Promise<Date> {
  const nextLeaseUntil = processingLeaseExpiry(now);
  const renewal = await database.email.updateMany({
    where: {
      id: emailId,
      status: EmailStatus.PROCESSING,
      processingLeaseUntil: currentLeaseUntil,
    },
    data: { processingLeaseUntil: nextLeaseUntil },
  });

  if (renewal.count !== 1) {
    throw new ProcessingLeaseLostError(emailId);
  }

  return nextLeaseUntil;
}
