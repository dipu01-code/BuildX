import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';

describe('BUILDX startup screen', () => {
  beforeEach(() => {
    window.buildxDesktop = {
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'BUILDX',
        version: '0.1.0',
        platform: 'darwin',
      }),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.buildxDesktop;
  });

  it('shows the app identity and confirms the desktop bridge is ready', async () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /build with more clarity/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('v0.1.0')).toBeInTheDocument());
    expect(screen.getByText(/running on darwin/i)).toBeInTheDocument();
    expect(screen.getByText('READY')).toBeInTheDocument();
    expect(screen.getByText('NEXT PHASE')).toBeInTheDocument();
  });

  it('explains when the desktop bridge is not available', async () => {
    delete window.buildxDesktop;
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/desktop bridge is unavailable/i);
  });

  it('shows a recoverable startup message when runtime metadata fails', async () => {
    window.buildxDesktop.getAppInfo.mockRejectedValue(new Error('IPC failure'));
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read desktop runtime information/i);
  });
});
