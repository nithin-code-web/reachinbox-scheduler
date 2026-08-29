import { Job, UnrecoverableError, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redisConnection } from '../db/redis.js';
import {
  SLACK_NOTIFICATION_QUEUE_NAME,
} from '../queues/slack.queue.js';
import type { SlackNotificationJobData } from '../types/slack.js';
import { postSlackMessage, SlackApiError } from '../services/slack.service.js';

function notificationText(data: SlackNotificationJobData): string {
  switch (data.event) {
    case 'campaign_scheduled':
      return `Campaign ${data.campaignId} scheduled${data.scheduledCount === undefined ? '' : ` with ${data.scheduledCount} emails`}.`;
    case 'campaign_scheduling_failed':
      return `Campaign ${data.campaignId} could not be fully scheduled.`;
    case 'email_sent':
      return `Email ${data.emailId ?? 'unknown'} sent to ${data.recipient ?? 'recipient'}.`;
    case 'email_failed':
      return `Email ${data.emailId ?? 'unknown'} permanently failed${data.recipient ? ` for ${data.recipient}` : ''}${data.errorMessage ? `: ${data.errorMessage}` : '.'}`;
  }
}

export async function processSlackNotificationJob(
  job: Job<SlackNotificationJobData>,
  send: typeof postSlackMessage = postSlackMessage,
): Promise<void> {
  logger.info(
    { event: job.data.event, eventId: job.data.eventId, jobId: job.id, userId: job.data.userId },
    'Slack notification job received',
  );

  try {
    const sent = await send(job.data.userId, notificationText(job.data));
    if (sent) {
      logger.info(
        { event: job.data.event, eventId: job.data.eventId, jobId: job.id },
        'Slack notification sent',
      );
    } else {
      logger.debug(
        { event: job.data.event, eventId: job.data.eventId },
        'Slack notification skipped because no channel is configured',
      );
    }
  } catch (error) {
    if (error instanceof SlackApiError && !error.retryable) {
      logger.warn(
        { event: job.data.event, eventId: job.data.eventId, code: error.code },
        'Permanent Slack notification failure',
      );
      throw new UnrecoverableError(error.message);
    }

    logger.warn(
      {
        event: job.data.event,
        eventId: job.data.eventId,
        jobId: job.id,
        code: error instanceof SlackApiError ? error.code : 'unknown_error',
      },
      'Transient Slack notification failure; BullMQ will retry',
    );
    throw error;
  }
}

async function slackNotificationProcessor(job: Job<SlackNotificationJobData>): Promise<void> {
  return processSlackNotificationJob(job);
}

export const slackNotificationWorker = new Worker<SlackNotificationJobData>(
  SLACK_NOTIFICATION_QUEUE_NAME,
  slackNotificationProcessor,
  {
    connection: redisConnection,
    concurrency: env.SLACK_NOTIFICATION_CONCURRENCY,
  },
);

slackNotificationWorker.on('error', (error) => {
  logger.error({ err: error }, 'Slack notification worker error');
});

slackNotificationWorker.on('failed', (job, error) => {
  logger.warn(
    { event: job?.data.event, eventId: job?.data.eventId, jobId: job?.id, code: error.name },
    'Slack notification job failed',
  );
});

slackNotificationWorker.on('completed', (job) => {
  logger.info(
    { event: job.data.event, eventId: job.data.eventId, jobId: job.id },
    'Slack notification job completed',
  );
});

logger.info(
  {
    queue: SLACK_NOTIFICATION_QUEUE_NAME,
    concurrency: env.SLACK_NOTIFICATION_CONCURRENCY,
  },
  'Slack notification worker started',
);

export async function closeSlackNotificationWorker(): Promise<void> {
  await slackNotificationWorker.close();
  logger.info('Slack notification worker shut down');
}
