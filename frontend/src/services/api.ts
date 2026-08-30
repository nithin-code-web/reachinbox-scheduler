import { mockScheduledEmails, mockSenders, mockSentEmails, mockUser } from '../data/mock';
import type { CampaignDraft, EmailRecord, Sender, User } from '../types';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const useMockData = (import.meta.env.VITE_USE_MOCK_DATA ?? 'true') === 'true';

export const googleLoginUrl = `${apiBaseUrl}/auth/google`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return (await response.json()) as T;
}

export const api = {
  async currentUser(): Promise<User | null> {
    if (useMockData) return mockUser;
    try {
      return await request<User>('/auth/me');
    } catch {
      return null;
    }
  },
  async scheduledEmails(): Promise<EmailRecord[]> {
    if (useMockData) return mockScheduledEmails;
    return request<EmailRecord[]>('/api/emails/scheduled');
  },
  async sentEmails(): Promise<EmailRecord[]> {
    if (useMockData) return mockSentEmails;
    return request<EmailRecord[]>('/api/emails/sent');
  },
  async sendCampaign(draft: CampaignDraft): Promise<void> {
    if (useMockData) return;
    await request('/api/campaigns', { method: 'POST', body: JSON.stringify(draft) });
  },
  async logout(): Promise<void> {
    if (!useMockData) await request('/auth/logout', { method: 'POST' });
  },
  async senders(): Promise<Sender[]> {
    if (useMockData) return mockSenders;
    return [];
  },
};
