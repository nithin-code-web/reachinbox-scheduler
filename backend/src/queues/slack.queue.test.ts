import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
process.env.ETHEREAL_USER ??= 'test-user';
process.env.ETHEREAL_PASSWORD ??= 'test-password';

const queuePromise = import('./slack.queue.js');

const data = {
  eventId: 'email-sent:email-1',
  event: 'email_sent' as const,
  userId: 'user-1',
  campaignId: 'campaign-1',
  emailId: 'email-1',
  recipient: 'recipient@example.com',
};

test('uses deterministic notification job IDs and does not include tokens', async () => {
  const { addSlackNotificationJob, slackNotificationJobId } = await queuePromise;
  let added: { name: string; data: typeof data; options: { jobId?: string } } | undefined;
  const queue = {
    add: async (name: string, jobData: typeof data, options: { jobId?: string }) => {
      added = { name, data: jobData, options };
      return {};
    },
  };

  await addSlackNotificationJob(data, queue as never);
  const jobId = slackNotificationJobId(data.eventId);
  assert.match(jobId, /^slack-[a-f0-9]{64}$/);
  assert.doesNotMatch(jobId, /:/);
  assert.equal(added?.options.jobId, jobId);
  assert.equal('accessToken' in (added?.data ?? {}), false);
});

test('accepts colon event IDs on BullMQ and preserves idempotency', async (context: TestContext) => {
  const { redisConnection } = await import('../db/redis.js');
  const { SLACK_NOTIFICATION_JOB_NAME, slackNotificationJobId, slackNotificationQueue } =
    await queuePromise;

  try {
    await redisConnection.ping();
  } catch {
    context.skip('Redis is required for BullMQ queue verification');
    return;
  }

  const eventId = 'campaign_scheduled:campaign-queue-test';
  const jobId = slackNotificationJobId(eventId);
  await slackNotificationQueue.getJob(jobId).then((job) => job?.remove());

  const first = await slackNotificationQueue.add(
    SLACK_NOTIFICATION_JOB_NAME,
    { ...data, eventId },
    { jobId, delay: 60_000 },
  );
  const second = await slackNotificationQueue.add(
    SLACK_NOTIFICATION_JOB_NAME,
    { ...data, eventId },
    { jobId, delay: 60_000 },
  );

  try {
    assert.equal(first.id, jobId);
    assert.equal(second.id, jobId);
    assert.doesNotMatch(first.id ?? '', /:/);
    assert.equal((await slackNotificationQueue.getJob(jobId))?.data.eventId, eventId);
  } finally {
    await first.remove();
  }
});

test('swallows queue failures so Slack cannot fail the email path', async () => {
  const { enqueueSlackNotification } = await queuePromise;
  await assert.doesNotReject(
    enqueueSlackNotification(data, {
      add: async () => {
        throw new Error('Redis unavailable');
      },
    } as never),
  );
});

test.after(async () => {
  const { closeSlackNotificationQueue } = await queuePromise;
  const { redisConnection } = await import('../db/redis.js');
  await closeSlackNotificationQueue();
  redisConnection.disconnect();
});
