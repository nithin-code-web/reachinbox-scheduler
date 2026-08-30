import assert from 'node:assert/strict';
import test from 'node:test';
import { UnrecoverableError } from 'bullmq';
import type { SlackNotificationEvent } from '../types/slack.js';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
process.env.ETHEREAL_USER ??= 'test-user';
process.env.ETHEREAL_PASSWORD ??= 'test-password';
process.env.SLACK_TOKEN_ENCRYPTION_KEY ??= 'a'.repeat(64);

const workerPromise = import('./slack.worker.js');

function job(event: SlackNotificationEvent = 'email_sent') {
  return {
    id: 'slack-event-1',
    data: {
      eventId: 'event-1',
      event,
      userId: 'user-1',
      campaignId: 'campaign-1',
      emailId: 'email-1',
      recipient: 'recipient@example.com',
      ...(event === 'email_failed' ? { errorMessage: 'SMTP rejected message' } : {}),
      ...(event === 'email_rate_limited'
        ? { senderId: 'sender-1', nextHourAt: '2026-08-30T12:00:00.000Z' }
        : {}),
    },
  };
}

test('processes a notification without putting Slack in the email worker path', async () => {
  const { processSlackNotificationJob } = await workerPromise;
  let message = '';
  await processSlackNotificationJob(job() as never, async (_userId, text) => {
    message = text;
    return true;
  });
  assert.match(message, /Email email-1 sent to recipient@example.com/);
});

test('renders a concise hourly-limit notification', async () => {
  const { processSlackNotificationJob } = await workerPromise;
  let message = '';
  await processSlackNotificationJob(job('email_rate_limited') as never, async (_userId, text) => {
    message = text;
    return true;
  });
  assert.equal(
    message,
    'Hourly email limit reached for sender sender-1. Email recipient@example.com was rescheduled to 2026-08-30T12:00:00.000Z.',
  );
});

test('propagates transient Slack errors for bounded BullMQ retries', async () => {
  const { processSlackNotificationJob } = await workerPromise;
  const error = new Error('temporary Slack failure');
  await assert.rejects(
    processSlackNotificationJob(job() as never, async () => {
      throw error;
    }),
    error,
  );
});

test('converts permanent Slack API failures into unrecoverable BullMQ failures', async () => {
  const { processSlackNotificationJob } = await workerPromise;
  const { SlackApiError } = await import('../services/slack.service.js');
  await assert.rejects(
    processSlackNotificationJob(job('email_failed') as never, async () => {
      throw new SlackApiError('Slack rejected the request', {
        retryable: false,
        code: 'channel_not_found',
      });
    }),
    (error: unknown) => error instanceof UnrecoverableError,
  );
});

test.after(async () => {
  const { closeSlackNotificationWorker } = await workerPromise;
  const { redisConnection } = await import('../db/redis.js');
  await closeSlackNotificationWorker();
  redisConnection.disconnect();
});
