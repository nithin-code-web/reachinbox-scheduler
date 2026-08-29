import assert from 'node:assert/strict';
import test from 'node:test';

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
  assert.equal(slackNotificationJobId(data.eventId), 'slack-email-sent:email-1');
  assert.equal(added?.options.jobId, 'slack-email-sent:email-1');
  assert.equal('accessToken' in (added?.data ?? {}), false);
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
  const { redisConnection } = await import('../db/redis.js');
  redisConnection.disconnect();
});
