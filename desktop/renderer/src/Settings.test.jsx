import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Settings from './Settings.jsx';

const saved = {
  version: 1,
  general: { startup_behavior: 'show_home', default_project_directory: null, confirm_destructive_actions: true },
  appearance: { theme: 'system', ui_density: 'compact' },
  editor: { font_size: 16, tab_size: 4, word_wrap: false, minimap: false, auto_save: true },
  ai_provider: { provider: 'openai', model: 'gpt-5.4-mini' },
  terminal: { default_working_directory: null, output_retention_limit: 20, timeout_ms: 300000 },
  project_context: { max_file_size_mb: 1, indexing_enabled: true },
  privacy: { telemetry_enabled: false },
};
const defaults = { ...saved, appearance: { theme: 'system', ui_density: 'comfortable' },
  editor: { font_size: 12, tab_size: 2, word_wrap: true, minimap: false, auto_save: false } };

describe('Settings', () => {
  beforeEach(() => {
    window.buildxDesktop = {
      getSettings: vi.fn().mockResolvedValueOnce(saved).mockResolvedValue(defaults),
      patchSettings: vi.fn(),
      resetSettings: vi.fn().mockResolvedValue({ version: 1, message: 'Settings reset to defaults' }),
      getSettingsHealth: vi.fn().mockResolvedValue({ overall: 'healthy', components: [], checked_at: '' }),
      getAIStatus: vi.fn().mockResolvedValue({ credential_available: false, connection_status: 'missing_credentials' }),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.buildxDesktop;
  });

  it('shares loaded settings and reloads full settings after a reset', async () => {
    const onSettingsChange = vi.fn();
    render(<Settings onSettingsChange={onSettingsChange} />);
    await waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith(saved));
    fireEvent.click(screen.getByRole('button', { name: /reset all to defaults/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset all' }));
    await waitFor(() => expect(onSettingsChange).toHaveBeenLastCalledWith(defaults));
    expect(window.buildxDesktop.resetSettings).toHaveBeenCalledTimes(1);
  });
});
