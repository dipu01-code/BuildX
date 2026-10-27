import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectAssistantPanel from './ProjectAssistantPanel.jsx';

const project = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Atlas' };
const conversationId = '550e8400-e29b-41d4-a716-446655440001';
const requestId = '550e8400-e29b-41d4-a716-446655440002';
const date = '2026-10-27T10:00:00Z';
const source = { relative_path: 'src/router.py', start_line: 4, end_line: 8 };
const userMessage = { id: '550e8400-e29b-41d4-a716-446655440003', request_id: requestId, role: 'user',
  content: 'How does routing work?', status: 'complete', sources: [], error_message: null, created_at: date };
const answer = { id: '550e8400-e29b-41d4-a716-446655440004', request_id: requestId, role: 'assistant',
  content: 'Routes are registered in one place.', status: 'complete', sources: [source], error_message: null, created_at: date };
const failedAnswer = { ...answer, content: '', status: 'failed', error_message: 'The AI provider rate limit was reached.' };
const summary = { id: conversationId, project_id: project.id, title: 'How does routing work?', message_count: 2,
  created_at: date, updated_at: date };
const detail = (messages = []) => ({ id: conversationId, project_id: project.id, title: summary.title,
  created_at: date, updated_at: date, messages });

describe('project coding assistant panel', () => {
  beforeEach(() => {
    window.buildxDesktop = {
      listConversations: vi.fn().mockResolvedValue([]),
      createConversation: vi.fn().mockResolvedValue(detail()),
      getConversation: vi.fn().mockResolvedValue(detail()),
      sendConversationMessage: vi.fn(),
      deleteConversation: vi.fn().mockResolvedValue(null),
    };
  });
  afterEach(() => { cleanup(); delete window.buildxDesktop; });

  it('creates a conversation, sends a question, and navigates to supplied sources', async () => {
    window.buildxDesktop.sendConversationMessage.mockResolvedValue({ user_message: userMessage, assistant_message: answer });
    window.buildxDesktop.listConversations.mockResolvedValueOnce([]).mockResolvedValue([summary]);
    window.buildxDesktop.getConversation.mockResolvedValue(detail([userMessage, answer]));
    const onOpenSource = vi.fn();
    render(<ProjectAssistantPanel project={project} onOpenSource={onOpenSource} />);
    expect(await screen.findByText(/no conversations yet/i)).toBeInTheDocument();
    expect(screen.getByText(/sent to the configured OpenAI provider/i)).toBeInTheDocument();
    const composer = screen.getByRole('textbox', { name: 'Your question' });
    fireEvent.change(composer, { target: { value: userMessage.content } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(answer.content)).toBeInTheDocument();
    expect(window.buildxDesktop.createConversation).toHaveBeenCalledExactlyOnceWith(project.id);
    expect(window.buildxDesktop.sendConversationMessage).toHaveBeenCalledOnce();
    expect(await screen.findByText('Lines 4–8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /src\/router.py/ }));
    expect(onOpenSource).toHaveBeenCalledExactlyOnceWith('src/router.py', 4);
  });

  it('prevents a repeated submit while one provider request is pending', async () => {
    let resolveSend;
    window.buildxDesktop.createConversation.mockResolvedValue({ id: conversationId });
    window.buildxDesktop.sendConversationMessage.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
    window.buildxDesktop.getConversation.mockResolvedValue(detail([userMessage, answer]));
    window.buildxDesktop.listConversations.mockResolvedValue([summary]);
    render(<ProjectAssistantPanel project={project} onOpenSource={vi.fn()} />);
    const composer = screen.getByRole('textbox', { name: 'Your question' });
    fireEvent.change(composer, { target: { value: 'How does routing work?' } });
    const form = composer.closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(window.buildxDesktop.sendConversationMessage).toHaveBeenCalledOnce());
    resolveSend({ user_message: userMessage, assistant_message: answer });
    await screen.findByText(answer.content);
  });

  it('retries a failed turn with the same request identifier and original question', async () => {
    window.buildxDesktop.listConversations.mockResolvedValue([summary]);
    window.buildxDesktop.getConversation.mockResolvedValueOnce(detail([userMessage, failedAnswer]))
      .mockResolvedValue(detail([userMessage, answer]));
    window.buildxDesktop.sendConversationMessage.mockResolvedValue({ user_message: userMessage, assistant_message: answer });
    render(<ProjectAssistantPanel project={project} onOpenSource={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Retry response' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry response' }));
    await screen.findByText(answer.content);
    expect(window.buildxDesktop.sendConversationMessage).toHaveBeenCalledExactlyOnceWith(
      project.id, conversationId, requestId, userMessage.content,
    );
  });

  it('keeps general answers distinct when no indexed excerpts matched', async () => {
    window.buildxDesktop.listConversations.mockResolvedValue([summary]);
    window.buildxDesktop.getConversation.mockResolvedValue(detail([userMessage, { ...answer, sources: [] }]));
    render(<ProjectAssistantPanel project={project} onOpenSource={vi.fn()} />);
    expect(await screen.findByText(/General answer · no indexed excerpts matched/)).toBeInTheDocument();
  });
});
