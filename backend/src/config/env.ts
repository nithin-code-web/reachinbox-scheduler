import 'dotenv/config';
import { z } from 'zod';

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  EMAIL_SEND_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  PROCESSING_LEASE_MS: z.coerce.number().int().min(10_000).default(300000),
  ELASTICSEARCH_URL: z.string().url().optional(),
  ELASTICSEARCH_NODE: z.string().url().optional(),
  ELASTICSEARCH_USERNAME: z.string().optional(),
  ELASTICSEARCH_PASSWORD: z.string().optional(),
  ELASTICSEARCH_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
  GOOGLE_CLIENT_ID: optionalNonEmptyString,
  GOOGLE_CLIENT_SECRET: optionalNonEmptyString,
  GOOGLE_REDIRECT_URI: optionalUrl,
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  SESSION_COOKIE_NAME: z.string().min(1).default('reachinbox_session'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
  OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  SESSION_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ETHEREAL_HOST: z.string().min(1).default('smtp.ethereal.email'),
  ETHEREAL_PORT: z.coerce.number().int().positive().default(587),
  ETHEREAL_USER: z.string().min(1),
  ETHEREAL_PASSWORD: z.string().min(1),
  ETHEREAL_SECURE: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() === 'true'),
})
  .refine((values) => values.ELASTICSEARCH_URL || values.ELASTICSEARCH_NODE, {
    message: 'ELASTICSEARCH_URL or ELASTICSEARCH_NODE is required',
    path: ['ELASTICSEARCH_URL'],
  })
  .refine(
    (values) => {
      const googleConfiguration = [
        values.GOOGLE_CLIENT_ID,
        values.GOOGLE_CLIENT_SECRET,
        values.GOOGLE_REDIRECT_URI,
      ];
      return googleConfiguration.every(Boolean) || googleConfiguration.every((value) => !value);
    },
    {
      message: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI must be configured together',
      path: ['GOOGLE_CLIENT_ID'],
    },
  );

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  ELASTICSEARCH_NODE: parsedEnv.ELASTICSEARCH_URL ?? parsedEnv.ELASTICSEARCH_NODE!,
  SESSION_COOKIE_SECURE:
    parsedEnv.NODE_ENV === 'production' ? true : parsedEnv.SESSION_COOKIE_SECURE,
};
