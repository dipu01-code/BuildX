import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AISettings from './AISettings.jsx';

const configuredStatus = {
  provider_configured: true,
  provider_id: 'openai',
  model_id: 'gpt-5.4-mini',
  credential_available: true,
  connection_status: 'not_tested',
};

describe('AI provider settings', () => {
  beforeEach(() => {
    window.buildxDesktop = {
      getAIStatus: vi.fn().mockResolvedValue(configuredStatus),
      testAIConnection: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.buildxDesktop;
  });

  it('shows an unconfigured provider without exposing or asking for a renderer credential', async () => {
    window.buildxDesktop.getAIStatus.mockResolvedValue({ ...configuredStatus,
      provider_configured: false, credential_available: false, connection_status: 'missing_credentials' });
    render(<AISettings />);

    expect(await screen.findByText(/stays on the backend/i)).toBeInTheDocument();
    expect(screen.getAllByText('Not configured')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
    expect(screen.queryByLabelText(/api key|credential value/i)).not.toBeInTheDocument();
    expect(window.buildxDesktop.testAIConnection).not.toHaveBeenCalled();
  });

  it('shows loading feedback, then a successful provider test', async () => {
    let finishTest;
    window.buildxDesktop.testAIConnection.mockReturnValue(new Promise((resolve) => { finishTest = resolve; }));
    render(<AISettings />);
    await screen.findByText('Not tested yet');

    const testButton = screen.getByRole('button', { name: /test connection/i });
    fireEvent.click(testButton);
    expect(screen.getByRole('button', { name: /testing connection/i })).toBeDisabled();
    expect(window.buildxDesktop.testAIConnection).toHaveBeenCalledOnce();

    finishTest({ success: true, provider_id: 'openai', model_id: 'gpt-5.4-mini',
      response_text: 'BUILDX connection verified.', duration_ms: 40 });
    expect(await screen.findByRole('status')).toHaveTextContent(/connection test passed in 40 ms/i);
    expect(screen.getByText(/BUILDX connection verified/i)).toBeInTheDocument();
  });

  it('shows sanitized failures and allows a retry', async () => {
    window.buildxDesktop.testAIConnection.mockResolvedValueOnce({
      success: false, error_category: 'rate_limited', message: 'The provider rate limit was reached. Wait a moment before retrying.',
    }).mockResolvedValueOnce({ success: true, response_text: 'OK', duration_ms: 7 });
    render(<AISettings />);
    const button = await screen.findByRole('button', { name: /test connection/i });
    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(/rate limit was reached/i);
    expect(screen.getByRole('button', { name: /retry connection test/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /retry connection test/i }));
    await waitFor(() => expect(window.buildxDesktop.testAIConnection).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('status')).toHaveTextContent(/connection test passed/i);
  });

  it('does not mark backend unavailability as a provider connection success', async () => {
    window.buildxDesktop.getAIStatus.mockRejectedValue(new Error('The local AI service could not be reached.'));
    render(<AISettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/local ai service could not be reached/i);
    expect(screen.queryByText('CONNECTED')).not.toBeInTheDocument();
  });
});
