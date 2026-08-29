import { Job, Queue } from 'bullmq';
import { redisConnection } from '../db/redis.js';

export const EMAIL_QUEUE_NAME = 'email-scheduler';
export const SEND_EMAIL_JOB_NAME = 'send-email';

export interface SendEmailJobData {
  emailId: string;
  campaignId: string;
  senderId: string;
  recipient: string;
}

export const emailQueue = new Queue<SendEmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
});

export function emailJobId(emailId: string): string {
  return `email-${emailId}`;
}

export async function addSendEmailJob(
  data: SendEmailJobData,
  delay: number,
): Promise<Job<SendEmailJobData>> {
  return emailQueue.add(SEND_EMAIL_JOB_NAME, data, {
    delay,
    jobId: emailJobId(data.emailId),
  });
}

export async function closeEmailQueue(): Promise<void> {
  await emailQueue.close();
}
