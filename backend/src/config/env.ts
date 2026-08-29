import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  ELASTICSEARCH_URL: z.string().url().optional(),
  ELASTICSEARCH_NODE: z.string().url().optional(),
  ELASTICSEARCH_USERNAME: z.string().optional(),
  ELASTICSEARCH_PASSWORD: z.string().optional(),
  ETHEREAL_HOST: z.string().min(1).default('smtp.ethereal.email'),
  ETHEREAL_PORT: z.coerce.number().int().positive().default(587),
  ETHEREAL_USER: z.string().min(1),
  ETHEREAL_PASSWORD: z.string().min(1),
  ETHEREAL_SECURE: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() === 'true'),
}).refine((values) => values.ELASTICSEARCH_URL || values.ELASTICSEARCH_NODE, {
  message: 'ELASTICSEARCH_URL or ELASTICSEARCH_NODE is required',
  path: ['ELASTICSEARCH_URL'],
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  ELASTICSEARCH_NODE: parsedEnv.ELASTICSEARCH_URL ?? parsedEnv.ELASTICSEARCH_NODE!,
};
