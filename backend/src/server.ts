import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeElasticsearch } from './db/elasticsearch.js';
import { closePostgres } from './db/postgres.js';
import { closePrisma } from './db/prisma.js';
import { closeRedis } from './db/redis.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { closeEmailQueue } from './queues/email.queue.js';
import { apiRouter } from './routes/index.js';
import { closeEmailWorker } from './workers/email.worker.js';

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());
app.use(apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'Backend server started');
});

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown started');

  server.close(async (serverError) => {
    if (serverError) logger.error({ err: serverError }, 'Error closing HTTP server');

    try {
      await closeEmailWorker();
      await closeEmailQueue();
      await Promise.all([closePostgres(), closePrisma(), closeRedis(), closeElasticsearch()]);
      logger.info('Graceful shutdown completed');
      process.exit(serverError ? 1 : 0);
    } catch (error) {
      logger.error({ err: error }, 'Error during graceful shutdown');
      process.exit(1);
    }
  });
}

process.once('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => void gracefulShutdown('SIGINT'));
