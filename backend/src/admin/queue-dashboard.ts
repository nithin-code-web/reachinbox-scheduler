import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { RequestHandler } from 'express';
import { emailQueue } from '../queues/email.queue.js';
import { slackNotificationQueue } from '../queues/slack.queue.js';

export const QUEUE_DASHBOARD_PATH = '/admin/queues';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(QUEUE_DASHBOARD_PATH);

export const queueDashboardAdapters = [
  new BullMQAdapter(emailQueue, { readOnlyMode: true }),
  new BullMQAdapter(slackNotificationQueue, { readOnlyMode: true }),
];

createBullBoard({
  queues: queueDashboardAdapters,
  serverAdapter,
});

export const queueDashboardRouter: RequestHandler = serverAdapter.getRouter();
