export interface SlackConnectionResponse {
  connected: boolean;
  teamId: string | null;
  channelId: string | null;
}

export interface SlackChannelResponse {
  id: string;
  name: string;
  isPrivate: boolean;
}

export type SlackNotificationEvent =
  | 'campaign_scheduled'
  | 'campaign_scheduling_failed'
  | 'email_sent'
  | 'email_failed';

export interface SlackNotificationJobData {
  eventId: string;
  event: SlackNotificationEvent;
  userId: string;
  campaignId: string;
  emailId?: string;
  recipient?: string;
  scheduledCount?: number;
  errorMessage?: string;
}
