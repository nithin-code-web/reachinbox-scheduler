import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redisConnection.on('error', (error) => {
  logger.warn({ err: error }, 'Redis connection error');
});

export async function closeRedis(): Promise<void> {
  if (redisConnection.status === 'end') return;
  await redisConnection.quit().catch(() => redisConnection.disconnect());
}
