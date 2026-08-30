import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { EmailStatus } from '@prisma/client';
import type { SlackNotificationJobData } from '../types/slack.js';

process.env.DATABASE_URL ??= 'postgresql://reachinbox:reachinbox_dev_password@localhost:5432/reachinbox';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.ELASTICSEARCH_URL ??= 'http://localhost:9200';
process.env.ETHEREAL_USER ??= 'test-user';
process.env.ETHEREAL_PASSWORD ??= 'test-password';
process.env.EMAIL_SEND_DELAY_MS ??= '0';
process.env.PROCESSING_LEASE_MS ??= '10000';

interface Fixture {
  userId: string;
  senderId: string;
  campaignId: string;
  emailId: string;
  recipient: string;
}

interface FakeJobOptions {
  attemptsMade?: number;
  attempts?: number;
  moveToDelayed?: (timestamp: number) => Promise<void>;
}

const setupPromise = (async () => {
  const [{ prisma }, { redisConnection }] = await Promise.all([
    import('../db/prisma.js'),
    import('../db/redis.js'),
  ]);

  try {
    await Promise.all([redisConnection.ping(), prisma.$queryRaw`SELECT 1`]);
    return { available: true, prisma, redisConnection };
  } catch {
    return { available: false, prisma, redisConnection };
  }
})();

const workerPromise = setupPromise.then(async (setup) => {
  if (!setup.available) return null;
  return import('./email.worker.js');
});

function id(): string {
  return crypto.randomUUID();
}

async function requireSetup(context: TestContext) {
  const setup = await setupPromise;
  if (!setup.available) {
    context.skip('PostgreSQL and Redis are required for worker reliability tests');
  }
  return setup;
}

async function createFixture(
  status: EmailStatus = EmailStatus.PROCESSING,
  options: { senderId?: string; userId?: string; hourlyLimit?: number; scheduledAt?: Date } = {},
): Promise<Fixture> {
  const { prisma } = await setupPromise;
  const userEmail = `reliability-${id()}@reachinbox.local`;
  const user = options.userId
    ? { id: options.userId }
    : await prisma.user.upsert({
        where: { email: userEmail },
        update: {},
        create: { email: userEmail, name: 'Reliability Test User' },
        select: { id: true },
      });
  const sender = options.senderId
    ? { id: options.senderId }
    : await prisma.sender.create({
        data: { userId: user.id, email: `sender-${id()}@ethereal.email`, displayName: 'Reliability Sender' },
        select: { id: true },
      });
  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      subject: 'Reliability test',
      body: 'Reliability test body',
      startTime: options.scheduledAt ?? new Date(),
      delaySeconds: 1,
      hourlyLimit: options.hourlyLimit ?? 100,
    },
    select: { id: true },
  });
  const email = await prisma.email.create({
    data: {
      campaignId: campaign.id,
      senderId: sender.id,
      recipient: `recipient-${id()}@example.com`,
      subject: 'Reliability test',
      body: 'Reliability test body',
      scheduledAt: options.scheduledAt ?? new Date(),
      status,
      processingLeaseUntil: status === EmailStatus.PROCESSING ? new Date(Date.now() - 1) : null,
      idempotencyKey: id(),
    },
    select: { id: true, recipient: true },
  });

  return {
    userId: user.id,
    senderId: sender.id,
    campaignId: campaign.id,
    emailId: email.id,
    recipient: email.recipient,
  };
}

async function deleteBullMqJob(emailId: string): Promise<void> {
  const { emailQueue } = await import('../queues/email.queue.js');
  await emailQueue.getJob(`email-${emailId}`).then((job) => job?.remove());
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  const { prisma, redisConnection } = await setupPromise;
  await deleteBullMqJob(fixture.emailId).catch(() => undefined);
  await prisma.campaign.delete({ where: { id: fixture.campaignId } }).catch(() => undefined);
  await prisma.sender.delete({ where: { id: fixture.senderId } }).catch(() => undefined);
  await redisConnection.del(
    `rate-limit:{${fixture.senderId}}`,
    `send-spacing:{${fixture.senderId}}`,
    `send-start-lock:{${fixture.senderId}}`,
    `email-recovery:{${fixture.emailId}}`,
  );
}

function fakeJob(fixture: Fixture, options: FakeJobOptions = {}) {
  let movedTo: number | undefined;
  return {
    id: `email-${fixture.emailId}`,
    token: 'reliability-test-token',
    attemptsMade: options.attemptsMade ?? 0,
    opts: { attempts: options.attempts ?? 3 },
    data: {
      emailId: fixture.emailId,
      campaignId: fixture.campaignId,
      senderId: fixture.senderId,
      recipient: fixture.recipient,
    },
    moveToDelayed: async (timestamp: number) => {
      movedTo = timestamp;
      await options.moveToDelayed?.(timestamp);
    },
    get movedTo() {
      return movedTo;
    },
  };
}

async function emailStatus(emailId: string) {
  const { prisma } = await setupPromise;
  return prisma.email.findUnique({
    where: { id: emailId },
    select: { status: true, sentAt: true, processingLeaseUntil: true, scheduledAt: true, errorMessage: true },
  });
}

test('persists delayed jobs and prevents duplicate creation with deterministic IDs', async (context) => {
  const setup = await requireSetup(context);
  if (!setup.available) return;
  const { addSendEmailJob, emailQueue } = await import('../queues/email.queue.js');
  const fixture = await createFixture(EmailStatus.SCHEDULED, { scheduledAt: new Date(Date.now() + 60_000) });
  const data = {
    emailId: fixture.emailId,
    campaignId: fixture.campaignId,
    senderId: fixture.senderId,
    recipient: fixture.recipient,
  };

  try {
    const first = await addSendEmailJob(data, 60_000);
    const second = await addSendEmailJob(data, 60_000);
    assert.equal(first.id, second.id);
    assert.equal(await (await emailQueue.getJob(first.id!))?.getState(), 'delayed');
  } finally {
    await emailQueue.getJob(`email-${fixture.emailId}`).then((job) => job?.remove());
    await cleanupFixture(fixture);
  }
});

test('recovers a scheduled email when its deterministic BullMQ job is missing', async (context) => {
  const setup = await requireSetup(context);
  if (!setup.available) return;
  const worker = await workerPromise;
  if (!worker) return;
  const { emailQueue } = await import('../queues/email.queue.js');
  const fixture = await createFixture(EmailStatus.SCHEDULED, { scheduledAt: new Date(Date.now() + 60_000) });

  try {
    await deleteBullMqJob(fixture.emailId);
    await worker.recoverScheduledEmailJobs();
    const recovered = await emailQueue.getJob(`email-${fixture.emailId}`);
    assert.ok(recovered);
    assert.equal(await recovered.getState(), 'delayed');
  } finally {
    await cleanupFixture(fixture);
  }
});

test('reclaims an expired processing lease and protects an active lease', async (context) => {
  const setup = await requireSetup(context);
  if (!setup.available) return;
  const { claimProcessingLease } = await import('../services/processing-lease.service.js');
  const fixture = await createFixture();
  try {
    const first = await claimProcessingLease(fixture.emailId);
    assert.ok(first);
    assert.equal(await claimProcessingLease(fixture.emailId), null);
    const reclaimed = await claimProcessingLease(fixture.emailId, undefined, new Date(first.getTime() + 1));
    assert.ok(reclaimed);
  } finally {
    await cleanupFixture(fixture);
  }
});

test('sends an email once even when the same job is processed twice', async (context) => {
  const setup = await requireSetup(context);
  if (!setup.available) return;
  const worker = await workerPromise;
  if (!worker) return;
  const { smtpTransporter } = await import('../config/smtp.js');
  const fixture = await createFixture();
  const originalSendMail = smtpTransporter.sendMail;
  let sendCount = 0;
  (smtpTransporter as unknown as { sendMail: () => Promise<{ messageId: string }> }).sendMail = async () => {
    sendCount += 1;
    return { messageId: `test-${sendCount}` };
  };

  try {
    await worker.processSendEmailJob(fakeJob(fixture) as never);
    await worker.processSendEmailJob(fakeJob(fixture) as never);
    const result = await emailStatus(fixture.emailId);
    assert.equal(sendCount, 1);
    assert.equal(result?.status, EmailStatus.SENT);
    assert.ok(result?.sentAt);
  } finally {
    smtpTransporter.sendMail = originalSendMail;
    await cleanupFixture(fixture);
  }
});

test('retries transient SMTP failure and eventually reaches SENT', async (context) => {
  const setup = await requireSetup(context);
  if (!setup.available) return;
  const worker = await workerPromise;
  if (!worker) return;
  const { smtpTransporter } = await import('../config/smtp.js');
  const fixture = await createFixture();
  const originalSendMail = smtpTransporter.sendMail;
  let attempts = 0;
  (smtpTransporter as unknown as { sendMail: () => Promise<unknown> }).sendMail = async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('temporary connection failure'), { code: 'ECONNECTION' });
    return {};
  };

  try {
    await assert.rejects(worker.processSendEmailJob(fakeJob(fixture, { attemptsMade: 0 }) as never), /temporary connection failure/);
    assert.equal((await emailStatus(fixture.emailId))?.status, EmailStatus.SCHEDULED);
    await worker.processSendEmailJob(fakeJob(fixture, { attemptsMade: 1 }) as never);
    assert.equal((await emailStatus(fixture.emailId))?.status, EmailStatus.SENT);
    assert.equal(attempts, 2);
  } finally {
    smtpTransporter.sendMail = originalSendMail;
    await cleanupFixture(fixture);
  }
});

test('marks permanent SMTP authentication failure as FAILED', async (context) => {
  const setup = await requireSetup(context);
  if (!setup.available) return;
  const worker = await workerPromise;
  if (!worker) return;
  const { smtpTransporter } = await import('../config/smtp.js');
  const fixture = await createFixture();
  const originalSendMail = smtpTransporter.sendMail;
  (smtpTransporter as unknown as { sendMail: () => Promise<unknown> }).sendMail = async () => {
    throw Object.assign(new Error('authentication failed'), { responseCode: 535 });
  };

  try {
    await assert.rejects(worker.processSendEmailJob(fakeJob(fixture) as never));
    const result = await emailStatus(fixture.emailId);
    assert.equal(result?.status, EmailStatus.FAILED);
    assert.match(result?.errorMessage ?? '', /authentication failed/);
  } finally {
    smtpTransporter.sendMail = originalSendMail;
    await cleanupFixture(fixture);
  }
});

test('enforces one global hourly limit across concurrent worker paths', async (context) => {
  const setup = await requireSetup(context);
  if (!setup.available) return;
  const worker = await workerPromise;
  if (!worker) return;
  const { smtpTransporter } = await import('../config/smtp.js');
  const first = await createFixture(undefined, { hourlyLimit: 2 });
  const second = await createFixture(undefined, { senderId: first.senderId, userId: first.userId, hourlyLimit: 2 });
  const third = await createFixture(undefined, { senderId: first.senderId, userId: first.userId, hourlyLimit: 2 });
  const fourth = await createFixture(undefined, { senderId: first.senderId, userId: first.userId, hourlyLimit: 2 });
  const fixtures = [first, second, third, fourth];
  const originalSendMail = smtpTransporter.sendMail;
  let sendCount = 0;
  (smtpTransporter as unknown as { sendMail: () => Promise<unknown> }).sendMail = async () => {
    sendCount += 1;
    return {};
  };

  try {
    const results = await Promise.allSettled(fixtures.map((item) => worker.processSendEmailJob(fakeJob(item) as never)));
    assert.equal(sendCount, 2);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 2);
    const states = await Promise.all(fixtures.map((item) => emailStatus(item.emailId)));
    assert.equal(states.filter((state) => state?.status === EmailStatus.SENT).length, 2);
    assert.equal(states.filter((state) => state?.status === EmailStatus.SCHEDULED).length, 2);
  } finally {
    smtpTransporter.sendMail = originalSendMail;
    await Promise.all(fixtures.map(cleanupFixture));
  }
});

test('keeps concurrent SMTP starts at least EMAIL_SEND_DELAY_MS apart', async (context) => {
  const setup = await requireSetup(context);
  if (!setup.available) return;
  const worker = await workerPromise;
  if (!worker) return;
  const { env } = await import('../config/env.js');
  const { smtpTransporter } = await import('../config/smtp.js');
  const first = await createFixture(undefined, { hourlyLimit: 10 });
  const second = await createFixture(undefined, { senderId: first.senderId, userId: first.userId, hourlyLimit: 10 });
  const originalDelay = env.EMAIL_SEND_DELAY_MS;
  const originalSendMail = smtpTransporter.sendMail;
  const starts: number[] = [];
  env.EMAIL_SEND_DELAY_MS = 30;
  (smtpTransporter as unknown as { sendMail: () => Promise<unknown> }).sendMail = async () => {
    starts.push(Date.now());
    return {};
  };

  try {
    await Promise.all([
      worker.processSendEmailJob(fakeJob(first) as never),
      worker.processSendEmailJob(fakeJob(second) as never),
    ]);
    assert.equal(starts.length, 2);
    const [firstStart, secondStart] = starts;
    if (firstStart === undefined || secondStart === undefined) {
      throw new Error('Expected two recorded SMTP start times');
    }
    assert.ok(Math.abs(secondStart - firstStart) >= 25);
  } finally {
    env.EMAIL_SEND_DELAY_MS = originalDelay;
    smtpTransporter.sendMail = originalSendMail;
    await cleanupFixture(first);
    await cleanupFixture(second);
  }
});

test('keeps durable scheduled state when a rate-limit reschedule move fails', async (context) => {
  const setup = await requireSetup(context);
  if (!setup.available) return;
  const worker = await workerPromise;
  if (!worker) return;
  const { smtpTransporter } = await import('../config/smtp.js');
  const first = await createFixture(undefined, { hourlyLimit: 1 });
  const second = await createFixture(undefined, { senderId: first.senderId, userId: first.userId, hourlyLimit: 1 });
  const originalSendMail = smtpTransporter.sendMail;
  (smtpTransporter as unknown as { sendMail: () => Promise<unknown> }).sendMail = async () => ({});

  try {
    await worker.processSendEmailJob(fakeJob(first) as never);
    await assert.rejects(
      worker.processSendEmailJob(fakeJob(second, { moveToDelayed: async () => { throw new Error('Redis move failed'); } }) as never),
      /Redis move failed/,
    );
    const result = await emailStatus(second.emailId);
    assert.equal(result?.status, EmailStatus.SCHEDULED);
    assert.equal(result?.processingLeaseUntil, null);
  } finally {
    smtpTransporter.sendMail = originalSendMail;
    await cleanupFixture(first);
    await cleanupFixture(second);
  }
});

test('enqueues one deterministic Slack notification when the hourly limit is reached', async (context) => {
  const setup = await requireSetup(context);
  if (!setup.available) return;
  const worker = await workerPromise;
  if (!worker) return;
  const { smtpTransporter } = await import('../config/smtp.js');
  const first = await createFixture(undefined, { hourlyLimit: 1 });
  const second = await createFixture(undefined, {
    senderId: first.senderId,
    userId: first.userId,
    hourlyLimit: 1,
  });
  const originalSendMail = smtpTransporter.sendMail;
  const notifications: SlackNotificationJobData[] = [];
  (smtpTransporter as unknown as { sendMail: () => Promise<unknown> }).sendMail = async () => ({});
  const dependencies = {
    enqueueSlackNotification: async (data: SlackNotificationJobData) => {
      notifications.push(data);
    },
  };

  try {
    await worker.processSendEmailJob(fakeJob(first) as never, dependencies);
    await assert.rejects(
      worker.processSendEmailJob(fakeJob(second) as never, dependencies),
      (error: unknown) => error instanceof Error && error.name === 'DelayedError',
    );

    const rateLimitNotifications = notifications.filter(
      (notification) => notification.event === 'email_rate_limited',
    );
    assert.equal(rateLimitNotifications.length, 1);
    const rateLimitNotification = rateLimitNotifications[0];
    assert.ok(rateLimitNotification);
    assert.deepEqual(rateLimitNotification, {
      eventId: `email-rate-limited:${second.emailId}:${new Date(rateLimitNotification.nextHourAt!).getTime()}`,
      event: 'email_rate_limited',
      userId: second.userId,
      campaignId: second.campaignId,
      senderId: second.senderId,
      emailId: second.emailId,
      recipient: second.recipient,
      nextHourAt: rateLimitNotification.nextHourAt,
    });
    assert.match(rateLimitNotification.nextHourAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    smtpTransporter.sendMail = originalSendMail;
    await cleanupFixture(first);
    await cleanupFixture(second);
  }
});

test.after(async () => {
  const worker = await workerPromise;
  if (worker) await worker.closeEmailWorker();
  const { prisma, redisConnection } = await setupPromise;
  await prisma.$disconnect();
  redisConnection.disconnect();
});
