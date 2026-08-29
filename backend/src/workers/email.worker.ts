import { EmailStatus } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import { redisConnection } from '../db/redis.js';
import {
  EMAIL_QUEUE_NAME,
  SendEmailJobData,
  emailJobId,
} from '../queues/email.queue.js';
import { smtpTransporter } from '../config/smtp.js';

const MAX_ERROR_MESSAGE_LENGTH = 500;

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
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ESOCKET',
    'ETLS',
  ].includes(smtpError.code ?? '');
}

function isFinalAttempt(job: Job<SendEmailJobData>): boolean {
  const attempts = job.opts.attempts ?? 1;
  return job.attemptsMade + 1 >= attempts;
}

async function processSendEmailJob(job: Job<SendEmailJobData>): Promise<void> {
  const { emailId } = job.data;
  const jobId = job.id ?? emailJobId(emailId);

  logger.info({ emailId, jobId, recipient: job.data.recipient }, 'Email job received');

  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true },
  });

  if (!email) {
    throw new Error(`Email record not found: ${emailId}`);
  }

  if (email.status === EmailStatus.SENT) {
    logger.info({ emailId, jobId }, 'Email already sent; skipping duplicate job');
    return;
  }

  if (email.status === EmailStatus.FAILED) {
    logger.warn({ emailId, jobId }, 'Email is already failed; refusing to resend');
    return;
  }

  if (email.status === EmailStatus.PROCESSING) {
    logger.warn({ emailId, jobId }, 'Email is already processing; skipping duplicate job');
    return;
  }

  const claim = await prisma.email.updateMany({
    where: { id: emailId, status: EmailStatus.SCHEDULED },
    data: { status: EmailStatus.PROCESSING },
  });

  if (claim.count !== 1) {
    logger.warn({ emailId, jobId }, 'Email was claimed by another worker; skipping job');
    return;
  }

  logger.info({ emailId, jobId }, 'Email transitioned to processing');

  try {
    logger.info(
      { emailId, jobId, recipient: email.recipient },
      'Sending email through Ethereal SMTP',
    );

    await smtpTransporter.sendMail({
      from: {
        address: email.sender.email,
        name: email.sender.displayName ?? email.sender.email,
      },
      to: email.recipient,
      subject: email.subject,
      text: email.body,
    });

    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: EmailStatus.SENT,
        sentAt: new Date(),
        errorMessage: null,
      },
    });

    logger.info({ emailId, recipient: email.recipient, jobId }, 'Email sent successfully');
  } catch (error) {
    // SMTP success followed by a process crash before this update can still
    // result in a duplicate on retry; email delivery cannot be exactly once.
    const errorMessage = safeErrorMessage(error);
    const retryable = isTransientSmtpError(error) && !isFinalAttempt(job);

    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: retryable ? EmailStatus.SCHEDULED : EmailStatus.FAILED,
        errorMessage,
      },
    });

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

    throw error;
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

export async function closeEmailWorker(): Promise<void> {
  await emailWorker.close();
  logger.info('Email worker shut down');
}
