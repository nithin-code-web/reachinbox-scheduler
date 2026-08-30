import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { test } from 'node:test';
import {
  QUEUE_DASHBOARD_PATH,
  queueDashboardAdapters,
  queueDashboardRouter,
} from './queue-dashboard.js';
import { closeEmailQueue } from '../queues/email.queue.js';
import { closeSlackNotificationQueue } from '../queues/slack.queue.js';
import { closeRedis } from '../db/redis.js';

test('registers both application BullMQ queues in read-only mode', () => {
  assert.deepEqual(
    queueDashboardAdapters.map((adapter) => adapter.getName()),
    ['email-scheduler', 'slack-notifications'],
  );
  assert.equal(queueDashboardAdapters.every((adapter) => adapter.readOnlyMode), true);
});

test('dashboard router can be mounted behind authentication middleware', async () => {
  const app = express();
  app.use(QUEUE_DASHBOARD_PATH, (_request, response) => {
    response.status(401).json({ error: 'Authentication required' });
  });
  app.use(QUEUE_DASHBOARD_PATH, queueDashboardRouter);

  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    if (!address || typeof address === 'string') throw new Error('Server did not bind to a port');

    const response = await fetch(`http://127.0.0.1:${address.port}${QUEUE_DASHBOARD_PATH}`);
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test.after(async () => {
  await closeEmailQueue();
  await closeSlackNotificationQueue();
  await closeRedis();
});
