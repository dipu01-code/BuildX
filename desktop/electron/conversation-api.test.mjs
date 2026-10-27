import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createConversationApi } = require('./conversation-api.cjs');
const projectId = '550e8400-e29b-41d4-a716-446655440000';
const conversationId = '550e8400-e29b-41d4-a716-446655440001';
const requestId = '550e8400-e29b-41d4-a716-446655440002';
const date = '2026-10-27T10:00:00Z';

function conversation(messages = []) {
  return { id: conversationId, project_id: projectId, title: 'Question', created_at: date, updated_at: date, messages };
}

function message(role = 'assistant') {
  return { id: '550e8400-e29b-41d4-a716-446655440003', request_id: requestId, role,
    content: 'Answer', status: 'complete', sources: [{ relative_path: 'src/main.py', start_line: 2, end_line: 3 }],
    error_message: null, created_at: date };
}

describe('project-scoped conversation API client', () => {
  it('uses bounded project paths and validates send responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ user_message: message('user'), assistant_message: message() }) });
    const api = createConversationApi({ getBaseUrl: () => 'http://127.0.0.1:1234', fetchImpl });
    const response = await api.sendMessage(projectId, conversationId, requestId, '  Question  ');
    expect(response.assistant_message.content).toBe('Answer');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.pathname).toBe(`/api/v1/projects/${projectId}/conversations/${conversationId}/messages`);
    expect(JSON.parse(init.body)).toEqual({ request_id: requestId, content: 'Question' });
    expect(init.signal).toBeDefined();
  });

  it('lists, loads and deletes only validated project conversations', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ conversations: [{
        id: conversationId, project_id: projectId, title: 'Chat', created_at: date, updated_at: date, message_count: 2,
      }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => conversation([message()]) })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null });
    const api = createConversationApi({ getBaseUrl: () => 'http://127.0.0.1:1234', fetchImpl });
    expect(await api.listConversations(projectId)).toHaveLength(1);
    expect(await api.getConversation(projectId, conversationId)).toMatchObject({ id: conversationId });
    await api.deleteConversation(projectId, conversationId);
    await expect(api.getConversation(projectId, '../other')).rejects.toThrow(/identifier/i);
  });

  it('returns sanitized server errors and rejects oversized content', async () => {
    const api = createConversationApi({ getBaseUrl: () => 'http://127.0.0.1:1234', fetchImpl: vi.fn() });
    await expect(api.sendMessage(projectId, conversationId, requestId, 'x'.repeat(8001))).rejects.toThrow(/8,000/i);
    const failed = createConversationApi({
      getBaseUrl: () => 'http://127.0.0.1:1234',
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { message: 'Provider is not configured.' } }) }),
    });
    await expect(failed.createConversation(projectId)).rejects.toThrow(/not configured/i);
  });
});
