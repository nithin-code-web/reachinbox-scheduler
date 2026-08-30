import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, request } from './api';

test('API client includes cookies and parses successful JSON', async () => {
  const originalFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    assert.deepEqual(await request<{ ok: boolean }>('/health'), { ok: true });
    assert.equal(capturedInit?.credentials, 'include');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API client exposes typed status errors without leaking raw responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { 'content-type': 'application/json' } });

  try {
    await assert.rejects(request('/private'), (error: unknown) => error instanceof ApiError && error.status === 401 && error.message === 'Authentication required');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API client uses the Slack connection endpoints without exposing credentials', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body as string | undefined });
    const path = new URL(String(input)).pathname;
    if (path === '/api/slack/connection') {
      return new Response(JSON.stringify({ connected: true, teamId: 'T123', channelId: 'C123' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (path === '/api/slack/channels') {
      return new Response(JSON.stringify({ channels: [{ id: 'C123', name: 'reachinbox-alerts', isPrivate: false }], nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ connected: false, teamId: null, channelId: null }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const { api } = await import('./api');
    await api.slackConnection();
    await api.slackChannels();
    await api.selectSlackChannel('C123');
    await api.disconnectSlack();
    assert.deepEqual(requests.map((request) => request.method), ['GET', 'GET', 'PATCH', 'DELETE']);
    assert.deepEqual(JSON.parse(requests[2].body ?? '{}'), { channelId: 'C123' });
    assert.equal(requests.some((request) => request.body?.includes('token')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
