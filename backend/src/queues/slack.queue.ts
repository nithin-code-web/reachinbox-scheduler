import crypto from 'node:crypto';
import { Job, Queue } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redisConnection } from '../db/redis.js';
import type { SlackNotificationJobData } from '../types/slack.js';

export const SLACK_NOTIFICATION_QUEUE_NAME = 'slack-notifications';
export const SLACK_NOTIFICATION_JOB_NAME = 'send-slack-notification';

export const slackNotificationQueue = new Queue<SlackNotificationJobData>(
  SLACK_NOTIFICATION_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: env.SLACK_NOTIFICATION_ATTEMPTS,
      backoff: { type: 'exponential', delay: 5_000 },
    },
  },
);

export function slackNotificationJobId(eventId: string): string {
  return `slack-${crypto.createHash('sha256').update(eventId).digest('hex')}`;
}

export async function addSlackNotificationJob(
  data: SlackNotificationJobData,
  queue: Queue<SlackNotificationJobData> = slackNotificationQueue,
): Promise<Job<SlackNotificationJobData>> {
  return queue.add(SLACK_NOTIFICATION_JOB_NAME, data, {
    jobId: slackNotificationJobId(data.eventId),
  });
}

/**
 * Notification enqueueing is deliberately best effort. The email state has
 * already been persisted before this function is called, so Slack outages
 * must not fail the email request or BullMQ email job.
 */
export async function enqueueSlackNotification(
  data: SlackNotificationJobData,
  queue: Queue<SlackNotificationJobData> = slackNotificationQueue,
): Promise<void> {
  try {
    await addSlackNotificationJob(data, queue);
  } catch (error) {
    logger.warn(
      { err: error, event: data.event, eventId: data.eventId, userId: data.userId },
      'Slack notification could not be queued',
    );
  }
}

export async function closeSlackNotificationQueue(): Promise<void> {
  await slackNotificationQueue.close();
}
