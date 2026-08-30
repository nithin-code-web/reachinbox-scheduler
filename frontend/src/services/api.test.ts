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
