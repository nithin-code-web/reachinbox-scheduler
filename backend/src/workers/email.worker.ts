import { EmailStatus, type EmailStatus as EmailStatusValue } from '@prisma/client';
import { DelayedError, Job, UnrecoverableError, Worker } from 'bullmq';
import { smtpTransporter } from '../config/smtp.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import { redisConnection } from '../db/redis.js';
import {
  EMAIL_QUEUE_NAME,
  SendEmailJobData,
  addSendEmailJob,
  emailJobId,
  emailQueue,
} from '../queues/email.queue.js';
import {
  HourlySlotReservation,
  SendStartSlot,
  acquireSendStartSlot,
  releaseHourlySlot,
  releaseSendStartSlot,
  reserveHourlySlot,
  revalidateHourlySlot,
} from '../services/rate-limit.service.js';
import {
  ProcessingLeaseLostError,
  claimProcessingLease,
  renewProcessingLease,
} from '../services/processing-lease.service.js';
import { rescheduleEmailForNextHour } from '../services/email-reschedule.service.js';
import { queueEmailIndexUpdate } from '../services/email-index.service.js';
import { enqueueSlackNotification } from '../queues/slack.queue.js';

const MAX_ERROR_MESSAGE_LENGTH = 500;
const SEND_START_LOCK_TTL_MS = Math.min(env.PROCESSING_LEASE_MS, 30_000);
const SCHEDULED_JOB_RECOVERY_INTERVAL_MS = 30_000;
const MAX_SCHEDULED_EMAILS_PER_RECOVERY = 1_000;
const RECOVERY_ATTEMPT_TTL_SECONDS = 60 * 60;

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown email delivery error';

  return message
    .replace(/(pass(word)?|auth(entication)?)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function isTransientSmtpError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const smtpError = error as { code?: string; responseCode?: number };
  if (smtpError.responseCode !== undefined) {
    return smtpError.responseCode >= 400 && smtpError.responseCode < 500;
  }

  return [
    'ECONNECTION',
    'ECONNABORTED',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'EAI_FAIL',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
    'ESOCKET',
    'ETIMEDOUT',
    'ETLS',
  ].includes(smtpError.code ?? '');
}

function isFinalAttempt(job: Job<SendEmailJobData>): boolean {
  const attempts = job.opts.attempts ?? 1;
  return job.attemptsMade + 1 >= attempts;
}

function wait(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class ProcessingLeaseGuard {
  private currentLeaseUntil: Date;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private renewalInFlight: Promise<void> | undefined;

  constructor(private readonly emailId: string, initialLeaseUntil: Date) {
    this.currentLeaseUntil = initialLeaseUntil;
  }

  get leaseUntil(): Date {
    return this.currentLeaseUntil;
  }

  async assertAndRenew(): Promise<void> {
    if (this.renewalInFlight) await this.renewalInFlight;

    this.currentLeaseUntil = await renewProcessingLease(
      this.emailId,
      this.currentLeaseUntil,
    );
  }

  startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    const intervalMs = Math.max(1_000, Math.floor(env.PROCESSING_LEASE_MS / 3));
    this.heartbeatTimer = setInterval(() => {
      void this.renewInBackground();
    }, intervalMs);
    this.heartbeatTimer.unref?.();
  }

  async stopHeartbeat(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.renewalInFlight) await this.renewalInFlight;
  }

  private renewInBackground(): Promise<void> {
    if (this.renewalInFlight) return this.renewalInFlight;

    this.renewalInFlight = (async () => {
      try {
        this.currentLeaseUntil = await renewProcessingLease(
          this.emailId,
          this.currentLeaseUntil,
        );
      } catch (error) {
        logger.warn(
          { err: error, emailId: this.emailId },
          'Processing lease heartbeat failed; the next checkpoint will revalidate ownership',
        );
      } finally {
        this.renewalInFlight = undefined;
      }
    })();

    return this.renewalInFlight;
  }
}

async function restoreScheduledStatus(
  emailId: string,
  leaseUntil: Date,
  errorMessage: string,
): Promise<void> {
  const restored = await prisma.email.updateMany({
    where: {
      id: emailId,
      status: EmailStatus.PROCESSING,
      processingLeaseUntil: leaseUntil,
    },
    data: {
      status: EmailStatus.SCHEDULED,
      processingLeaseUntil: null,
      errorMessage,
    },
  });

  if (restored.count === 1) return;

  // A reschedule operation may already have persisted SCHEDULED before its
  // BullMQ operation failed. Do not overwrite a newer processing owner.
  const current = await prisma.email.findUnique({
    where: { id: emailId },
    select: { status: true },
  });
  if (current?.status === EmailStatus.SCHEDULED) return;

  throw new ProcessingLeaseLostError(emailId);
}

async function transitionToSent(emailId: string, leaseUntil: Date): Promise<void> {
  const updated = await prisma.email.updateMany({
    where: {
      id: emailId,
      status: EmailStatus.PROCESSING,
      processingLeaseUntil: leaseUntil,
    },
    data: {
      status: EmailStatus.SENT,
      sentAt: new Date(),
      processingLeaseUntil: null,
      errorMessage: null,
    },
  });

  if (updated.count !== 1) throw new ProcessingLeaseLostError(emailId);
}

async function transitionAfterSmtpFailure(
  emailId: string,
  leaseUntil: Date,
  status: EmailStatusValue,
  errorMessage: string,
): Promise<void> {
  const updated = await prisma.email.updateMany({
    where: {
      id: emailId,
      status: EmailStatus.PROCESSING,
      processingLeaseUntil: leaseUntil,
    },
    data: {
      status,
      processingLeaseUntil: null,
      errorMessage,
    },
  });

  if (updated.count !== 1) throw new ProcessingLeaseLostError(emailId);
}

async function waitForSendStartSlot(senderId: string): Promise<SendStartSlot> {
  for (;;) {
    const slot = await acquireSendStartSlot(
      senderId,
      env.EMAIL_SEND_DELAY_MS,
      SEND_START_LOCK_TTL_MS,
    );

    if (slot.acquired) return slot;

    // The script uses Redis time. The small floor avoids a busy loop when the
    // host clock is ahead of Redis and reports a negative local wait.
    await wait(Math.max(50, slot.retryAt - Date.now()));
  }
}

async function releaseHeldSendStartSlot(
  senderId: string,
  slot: SendStartSlot | undefined,
  restoreReservation: boolean,
): Promise<void> {
  if (!slot) return;

  try {
    await releaseSendStartSlot(senderId, slot, restoreReservation);
  } catch (error) {
    logger.error(
      { err: error, senderId },
      'Failed to release the send-start coordination slot',
    );
  }
}

async function processSendEmailJob(job: Job<SendEmailJobData>): Promise<void> {
  const { emailId } = job.data;
  const jobId = job.id ?? emailJobId(emailId);

  logger.info({ emailId, jobId, recipient: job.data.recipient }, 'Email job received');

  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true, campaign: true },
  });

  if (!email) throw new Error(`Email record not found: ${emailId}`);

  if (email.status === EmailStatus.SENT) {
    logger.info({ emailId, jobId }, 'Email already sent; skipping duplicate job');
    return;
  }

  if (email.status === EmailStatus.FAILED) {
    logger.warn({ emailId, jobId }, 'Email is already failed; refusing to resend');
    return;
  }

  if (
    email.status === EmailStatus.PROCESSING &&
    email.processingLeaseUntil &&
    email.processingLeaseUntil > new Date()
  ) {
    logger.warn({ emailId, jobId }, 'Email has an active processing lease; skipping job');
    return;
  }

  const claimedLeaseUntil = await claimProcessingLease(emailId);
  if (!claimedLeaseUntil) {
    logger.warn({ emailId, jobId }, 'Email was claimed by another healthy worker; skipping job');
    return;
  }

  const lease = new ProcessingLeaseGuard(emailId, claimedLeaseUntil);
  let hourlyReservation: HourlySlotReservation | undefined;
  let sendStartSlot: SendStartSlot | undefined;
  let smtpAttemptStarted = false;
  let smtpSendSucceeded = false;

  logger.info({ emailId, jobId, leaseUntil: lease.leaseUntil }, 'Email transitioned to processing');
  queueEmailIndexUpdate(emailId);
  lease.startHeartbeat();

  try {
    await lease.assertAndRenew();

    hourlyReservation = await reserveHourlySlot(
      email.senderId,
      email.campaign.id,
      email.id,
      email.campaign.hourlyLimit,
    );

    if (!hourlyReservation.allowed) {
      logger.info(
        { emailId, jobId, scheduledAt: new Date(hourlyReservation.nextHourAt) },
        'Email rescheduled for the next UTC hour after rate limit was exceeded',
      );
      await rescheduleEmailForNextHour(
        job,
        emailId,
        lease.leaseUntil,
        hourlyReservation.nextHourAt,
      );
    }

    // The gate is acquired only when Redis says the actual start slot is now.
    // It is released immediately after sendMail is invoked, never after SMTP.
    sendStartSlot = await waitForSendStartSlot(email.senderId);

    await lease.assertAndRenew();
    hourlyReservation = await revalidateHourlySlot(
      email.senderId,
      email.campaign.id,
      hourlyReservation,
      email.campaign.hourlyLimit,
    );

    if (!hourlyReservation.allowed) {
      await releaseHeldSendStartSlot(email.senderId, sendStartSlot, true);
      sendStartSlot = undefined;
      logger.info(
        { emailId, jobId, scheduledAt: new Date(hourlyReservation.nextHourAt) },
        'Email rescheduled for the next UTC hour after rate limit was exceeded',
      );
      await rescheduleEmailForNextHour(
        job,
        emailId,
        lease.leaseUntil,
        hourlyReservation.nextHourAt,
      );
    }

    // Re-check after the lease checkpoint so the final Redis hour is as close
    // as practical to the external SMTP invocation.
    await lease.assertAndRenew();
    hourlyReservation = await revalidateHourlySlot(
      email.senderId,
      email.campaign.id,
      hourlyReservation,
      email.campaign.hourlyLimit,
    );

    if (!hourlyReservation.allowed) {
      await releaseHeldSendStartSlot(email.senderId, sendStartSlot, true);
      sendStartSlot = undefined;
      logger.info(
        { emailId, jobId, scheduledAt: new Date(hourlyReservation.nextHourAt) },
        'Email rescheduled for the next UTC hour after rate limit was exceeded',
      );
      await rescheduleEmailForNextHour(
        job,
        emailId,
        lease.leaseUntil,
        hourlyReservation.nextHourAt,
      );
    }

    await lease.assertAndRenew();
    smtpAttemptStarted = true;
    logger.info(
      { emailId, jobId, recipient: email.recipient },
      'Starting SMTP send after throttling',
    );

    const smtpPromise = smtpTransporter.sendMail({
      from: {
        address: email.sender.email,
        name: email.sender.displayName ?? email.sender.email,
      },
      to: email.recipient,
      subject: email.subject,
      text: email.body,
    });

    // Release the short gate after the SMTP operation has begun. A lock TTL
    // still protects the process-crash window before this release executes.
    await releaseHeldSendStartSlot(email.senderId, sendStartSlot, false);
    sendStartSlot = undefined;
    await smtpPromise;
    smtpSendSucceeded = true;

    await lease.stopHeartbeat();
    await transitionToSent(emailId, lease.leaseUntil);
    queueEmailIndexUpdate(emailId);
    void enqueueSlackNotification({
      eventId: `email-sent:${emailId}`,
      event: 'email_sent',
      userId: email.campaign.userId,
      campaignId: email.campaignId,
      emailId,
      recipient: email.recipient,
    });

    logger.info({ emailId, recipient: email.recipient, jobId }, 'Email sent successfully');
  } catch (error) {
    await releaseHeldSendStartSlot(email.senderId, sendStartSlot, !smtpAttemptStarted);
    sendStartSlot = undefined;
    await lease.stopHeartbeat();

    if (error instanceof DelayedError) {
      queueEmailIndexUpdate(emailId);
      throw error;
    }

    // SMTP success followed by a process crash or database failure remains an
    // inherently ambiguous delivery window; email cannot be exactly once.
    if (smtpSendSucceeded) {
      logger.error(
        { err: error, emailId, jobId },
        'SMTP accepted the email but SENT status could not be persisted',
      );
      throw error;
    }

    const errorMessage = safeErrorMessage(error);

    // A stale worker must not release a reservation or overwrite state that a
    // newer owner may already have acquired.
    if (error instanceof ProcessingLeaseLostError) throw error;

    if (!smtpAttemptStarted) {
      if (hourlyReservation?.allowed) {
        try {
          await releaseHourlySlot(
            email.senderId,
            hourlyReservation.hourStart,
            hourlyReservation.reservationId,
          );
        } catch (releaseError) {
          logger.error(
            { err: releaseError, emailId, jobId },
            'Failed to release hourly rate-limit slot after pre-send failure',
          );
        }
      }

      await restoreScheduledStatus(emailId, lease.leaseUntil, errorMessage);
      queueEmailIndexUpdate(emailId);
      logger.error(
        { err: error, emailId, jobId },
        'Pre-SMTP throttling failure; email returned to scheduled state',
      );
      throw error;
    }

    const retryable = isTransientSmtpError(error) && !isFinalAttempt(job);
    await transitionAfterSmtpFailure(
      emailId,
      lease.leaseUntil,
      retryable ? EmailStatus.SCHEDULED : EmailStatus.FAILED,
      errorMessage,
    );
    queueEmailIndexUpdate(emailId);
    if (!retryable) {
      void enqueueSlackNotification({
        eventId: `email-failed:${emailId}`,
        event: 'email_failed',
        userId: email.campaign.userId,
        campaignId: email.campaignId,
        emailId,
        recipient: email.recipient,
        errorMessage,
      });
    }

    logger.error(
      {
        err: error,
        emailId,
        recipient: email.recipient,
        jobId,
        retryable,
        attempt: job.attemptsMade + 1,
      },
      retryable ? 'Transient email send failure; job will be retried' : 'Email send failed',
    );

    // Do not spend the remaining BullMQ attempts on errors that are already
    // classified as permanent.
    throw retryable ? error : new UnrecoverableError(errorMessage);
  }
}

// Reconciliation is deliberately bounded. PostgreSQL remains the durable
// source of SCHEDULED state if Redis is unavailable for longer than this pass.
async function recoveryAttemptAllowed(emailId: string): Promise<boolean> {
  const key = `email-recovery:{${emailId}}`;
  const attempts = await redisConnection.incr(key);
  if (attempts === 1) {
    await redisConnection.expire(key, RECOVERY_ATTEMPT_TTL_SECONDS);
  }
  return attempts <= 1;
}

async function recoverScheduledEmailJobs(): Promise<void> {
  const emails = await prisma.email.findMany({
    where: { status: EmailStatus.SCHEDULED },
    orderBy: { scheduledAt: 'asc' },
    take: MAX_SCHEDULED_EMAILS_PER_RECOVERY,
    select: {
      id: true,
      campaignId: true,
      senderId: true,
      recipient: true,
      scheduledAt: true,
    },
  });

  for (const email of emails) {
    const jobId = emailJobId(email.id);
    const job = await emailQueue.getJob(jobId);

    if (!job) {
      if (!(await recoveryAttemptAllowed(email.id))) continue;

      await addSendEmailJob(
        {
          emailId: email.id,
          campaignId: email.campaignId,
          senderId: email.senderId,
          recipient: email.recipient,
        },
        Math.max(0, email.scheduledAt.getTime() - Date.now()),
      );
      logger.warn({ emailId: email.id, jobId }, 'Recovered scheduled email with missing BullMQ job');
      continue;
    }

    const state = await job.getState();
    if (state === 'failed' || state === 'completed') {
      if (!(await recoveryAttemptAllowed(email.id))) continue;

      if (state === 'failed') {
        await job.retry('failed');
      } else {
        await job.remove();
        await addSendEmailJob(
          {
            emailId: email.id,
            campaignId: email.campaignId,
            senderId: email.senderId,
            recipient: email.recipient,
          },
          Math.max(0, email.scheduledAt.getTime() - Date.now()),
        );
      }

      logger.warn({ emailId: email.id, jobId, state }, 'Recovered scheduled email job state');
    }
  }
}

export const emailWorker = new Worker<SendEmailJobData>(EMAIL_QUEUE_NAME, processSendEmailJob, {
  connection: redisConnection,
  concurrency: env.WORKER_CONCURRENCY,
});

emailWorker.on('error', (error) => {
  logger.error({ err: error }, 'Email worker error');
});

emailWorker.on('failed', (job, error) => {
  logger.error(
    { err: error, emailId: job?.data.emailId, jobId: job?.id },
    'Email worker job failed',
  );
});

emailWorker.on('completed', (job) => {
  logger.info({ emailId: job.data.emailId, jobId: job.id }, 'Email worker job completed');
});

logger.info(
  { queue: EMAIL_QUEUE_NAME, concurrency: env.WORKER_CONCURRENCY },
  'Email worker started',
);

let recoveryTimer: NodeJS.Timeout | undefined;
let recoveryInFlight: Promise<void> | undefined;

function runScheduledJobRecovery(): void {
  if (recoveryInFlight) return;

  recoveryInFlight = recoverScheduledEmailJobs()
    .catch((error) => {
      logger.warn({ err: error }, 'Scheduled email job recovery pass failed');
    })
    .finally(() => {
      recoveryInFlight = undefined;
    });
}

runScheduledJobRecovery();
recoveryTimer = setInterval(runScheduledJobRecovery, SCHEDULED_JOB_RECOVERY_INTERVAL_MS);
recoveryTimer.unref?.();

export async function closeEmailWorker(): Promise<void> {
  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = undefined;
  }
  if (recoveryInFlight) await recoveryInFlight;

  await emailWorker.close();
  logger.info('Email worker shut down');
}
