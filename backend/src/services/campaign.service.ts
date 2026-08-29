import { EmailStatus } from '@prisma/client';
import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import { addSendEmailJob } from '../queues/email.queue.js';
import { AppError } from '../utils/app-error.js';

export interface CreateCampaignInput {
  subject: string;
  body: string;
  recipients: string[];
  senderId: string;
  startTime: Date;
  delaySeconds: number;
  hourlyLimit: number;
}

export interface ScheduledEmailResponse {
  id: string;
  recipient: string;
  scheduledAt: Date;
  status: EmailStatus;
}

export interface CreateCampaignResult {
  campaignId: string;
  scheduledCount: number;
  emails: ScheduledEmailResponse[];
}

export async function createCampaign(input: CreateCampaignInput): Promise<CreateCampaignResult> {
  const { campaign, emails } = await prisma.$transaction(async (transaction) => {
    const sender = await transaction.sender.findUnique({
      where: { id: input.senderId },
      select: { userId: true },
    });

    if (!sender) {
      throw new AppError('Sender not found', 404);
    }

    const campaign = await transaction.campaign.create({
      data: {
        userId: sender.userId,
        subject: input.subject,
        body: input.body,
        startTime: input.startTime,
        delaySeconds: input.delaySeconds,
        hourlyLimit: input.hourlyLimit,
      },
    });

    const emails = [];
    for (const [index, recipient] of input.recipients.entries()) {
      const scheduledAt = new Date(
        input.startTime.getTime() + index * input.delaySeconds * 1000,
      );

      const email = await transaction.email.create({
        data: {
          campaignId: campaign.id,
          senderId: input.senderId,
          recipient,
          subject: input.subject,
          body: input.body,
          scheduledAt,
          idempotencyKey: crypto.randomUUID(),
        },
        select: {
          id: true,
          recipient: true,
          scheduledAt: true,
          status: true,
        },
      });

      emails.push(email);
    }

    return { campaign, emails };
  });

  // PostgreSQL and Redis do not share a distributed transaction. Database rows
  // are created first; any queue failure is persisted as FAILED and returned as
  // an error instead of being reported as a successful schedule.
  const enqueuedEmailIds = new Set<string>();

  try {
    for (const email of emails) {
      const delay = Math.max(0, email.scheduledAt.getTime() - Date.now());
      const jobId = `email-${email.id}`;

      await addSendEmailJob(
        {
          emailId: email.id,
          campaignId: campaign.id,
          senderId: input.senderId,
          recipient: email.recipient,
        },
        delay,
      );

      await prisma.email.update({
        where: { id: email.id },
        data: { bullmqJobId: jobId },
      });

      enqueuedEmailIds.add(email.id);
    }
  } catch (error) {
    const unscheduledEmailIds = emails
      .filter((email) => !enqueuedEmailIds.has(email.id))
      .map((email) => email.id);

    try {
      if (unscheduledEmailIds.length > 0) {
        await prisma.email.updateMany({
          where: { id: { in: unscheduledEmailIds } },
          data: {
            status: EmailStatus.FAILED,
            errorMessage: 'Failed to create BullMQ scheduling job',
          },
        });
      }
    } catch (persistenceError) {
      logger.error(
        { err: persistenceError, campaignId: campaign.id },
        'Failed to persist email scheduling failure',
      );
    }

    logger.error(
      {
        err: error,
        campaignId: campaign.id,
        enqueuedCount: enqueuedEmailIds.size,
        totalEmails: emails.length,
      },
      'Campaign created but email scheduling jobs could not be fully created',
    );

    throw new AppError('Campaign created, but email scheduling failed', 503);
  }

  logger.info(
    { campaignId: campaign.id, scheduledCount: emails.length },
    'Campaign scheduled successfully',
  );

  return {
    campaignId: campaign.id,
    scheduledCount: emails.length,
    emails,
  };
}
