import { EmailStatus, PrismaClient } from '@prisma/client';
import { DelayedError, Job } from 'bullmq';
import { prisma } from '../db/prisma.js';
import { ProcessingLeaseLostError } from './processing-lease.service.js';
import type { SendEmailJobData } from '../queues/email.queue.js';

export type EmailRescheduleDatabase = Pick<PrismaClient, 'email'>;

export async function rescheduleEmailForNextHour(
  job: Job<SendEmailJobData>,
  emailId: string,
  leaseUntil: Date,
  nextHourAt: number,
  database: EmailRescheduleDatabase = prisma,
): Promise<never> {
  const scheduledAt = new Date(nextHourAt);
  const updated = await database.email.updateMany({
    where: {
      id: emailId,
      status: EmailStatus.PROCESSING,
      processingLeaseUntil: leaseUntil,
    },
    data: {
      status: EmailStatus.SCHEDULED,
      processingLeaseUntil: null,
      scheduledAt,
      errorMessage: null,
    },
  });

  if (updated.count !== 1) throw new ProcessingLeaseLostError(emailId);

  // The database update is durable before the queue move. If Redis fails,
  // recovery can find this SCHEDULED record and repair its deterministic job.
  await job.moveToDelayed(nextHourAt, job.token);
  throw new DelayedError();
}
