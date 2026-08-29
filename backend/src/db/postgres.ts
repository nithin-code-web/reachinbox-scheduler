import { Pool } from 'pg';
import { env } from '../config/env.js';

export const postgresPool = new Pool({ connectionString: env.DATABASE_URL });

export async function closePostgres(): Promise<void> {
  await postgresPool.end();
}
