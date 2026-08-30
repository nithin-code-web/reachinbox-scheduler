export type Mailbox = 'scheduled' | 'sent';

export type EmailStatus = 'SCHEDULED' | 'SENT' | 'PROCESSING' | 'FAILED';

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

export interface EmailRecord {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sentAt?: string | null;
  status: EmailStatus;
  senderName: string;
  senderEmail: string;
  preview: string;
}

export interface Sender {
  id: string;
  email: string;
  displayName?: string | null;
}

export interface CampaignDraft {
  subject: string;
  body: string;
  recipients: string[];
  senderId: string;
  startTime: string;
  delaySeconds: number;
  hourlyLimit: number;
}
