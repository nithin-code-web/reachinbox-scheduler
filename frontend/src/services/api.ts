import { mockScheduledEmails, mockSenders, mockSentEmails, mockUser } from '../data/mock';
import type { CampaignDraft, EmailPagination, EmailRecord, EmailSearchResponse, Sender, User } from '../types';

const runtimeEnv = import.meta.env ?? {};
const apiBaseUrl = (runtimeEnv.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const useMockData = (runtimeEnv.VITE_USE_MOCK_DATA ?? 'false') === 'true';
const defaultSenderId = runtimeEnv.VITE_DEFAULT_SENDER_ID?.trim() ?? '';

export const googleLoginUrl = `${apiBaseUrl}/auth/google`;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function safeErrorMessage(status: number, message: unknown): string {
  if (status >= 500) return 'The server is temporarily unavailable.';
  if (typeof message === 'string' && message.length > 0) return message;
  if (status === 400) return 'Please check the form and try again.';
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'The requested resource was not found.';
  if (status >= 500) return 'The server is temporarily unavailable.';
  return 'The request could not be completed.';
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'Network error. Check your connection and try again.');
  }

  let payload: unknown = null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try { payload = await response.json(); } catch { payload = null; }
  }

  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload ? payload.error : undefined;
    throw new ApiError(response.status, safeErrorMessage(response.status, message));
  }

  if (response.status === 204) return undefined as T;
  return payload as T;
}

const mockPagination = (items: EmailRecord[]): EmailPagination => ({ page: 1, limit: items.length || 20, total: items.length, totalPages: 1 });

export const api = {
  async currentUser(): Promise<User | null> {
    if (useMockData) return mockUser;
    try {
      const response = await request<{ user: User }>('/auth/me');
      return response.user;
    } catch (error) {
      if (isApiError(error) && error.status === 401) return null;
      throw error;
    }
  },
  async scheduledEmails(): Promise<EmailRecord[]> {
    return useMockData ? mockScheduledEmails : request<EmailRecord[]>('/api/emails/scheduled');
  },
  async sentEmails(): Promise<EmailRecord[]> {
    return useMockData ? mockSentEmails : request<EmailRecord[]>('/api/emails/sent');
  },
  async searchEmails(params: { q: string; status: 'SCHEDULED' | 'SENT'; page: number; limit: number }): Promise<EmailSearchResponse> {
    if (useMockData) {
      const source = params.status === 'SCHEDULED' ? mockScheduledEmails : mockSentEmails;
      const query = params.q.toLowerCase();
      const items = source.filter((email) => `${email.recipient} ${email.subject ?? ''}`.toLowerCase().includes(query));
      return { items, pagination: mockPagination(items) };
    }
    const query = new URLSearchParams({ q: params.q, status: params.status, page: String(params.page), limit: String(params.limit) });
    return request<EmailSearchResponse>(`/api/emails/search?${query.toString()}`);
  },
  async sendCampaign(draft: CampaignDraft): Promise<void> {
    if (!useMockData) await request('/api/campaigns', { method: 'POST', body: JSON.stringify(draft) });
  },
  async logout(): Promise<void> {
    if (!useMockData) await request('/auth/logout', { method: 'POST' });
  },
  async senders(): Promise<Sender[]> {
    if (useMockData) return mockSenders;
    return defaultSenderId ? [{ id: defaultSenderId, displayName: 'Configured sender', email: 'Configured sender ID' }] : [];
  },
};

export { defaultSenderId };
