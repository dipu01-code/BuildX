import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'ai_provider', label: 'AI Provider' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'project_context', label: 'Project Context' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'health', label: 'Operational Health' },
];

const THEMES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const STARTUP_BEHAVIORS = [
  { id: 'show_home', label: 'Show the home screen' },
  { id: 'open_last_project', label: 'Open the last project' },
];

const UI_DENSITIES = [
  { id: 'compact', label: 'Compact' },
  { id: 'comfortable', label: 'Comfortable' },
];

/** @param {{ value: string, onChange: (value: string) => void, label: string, placeholder?: string, maxLength?: number }} props */
function TextInput({ id, value, onChange, label, placeholder = '', maxLength }) {
  return (
    <>
      <label id={`${id}-label`} htmlFor={id} className="settings-label">{label}</label>
      <input
        id={id}
        aria-labelledby={`${id}-label`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="settings-input"
      />
    </>
  );
}

/** @param {{ name: string, value: string | boolean | number, onChange: (value: string | boolean | number) => void, options: Array<{ id: string, label: string }>, label: string }} props */
function Select({ name, value, onChange, options, label }) {
  return (
    <>
      <label htmlFor={`settings-${name}`} className="settings-label">{label}</label>
      <select
        id={`settings-${name}`}
        aria-label={label}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        className="settings-input"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </>
  );
}

/** @param {{ id: string, label: string, checked: boolean, onChange: (checked: boolean) => void, description?: string }} props */
function Checkbox({ id, label, checked, onChange, description }) {
  return (
    <div className="settings-checkbox-row">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={() => onChange(!checked)}
        className="settings-checkbox"
      />
      <label htmlFor={id} className="settings-checkbox-label">
        <strong>{label}</strong>
        {description && <span className="settings-checkbox-desc">{description}</span>}
      </label>
    </div>
  );
}

/** @param {{ message: string, onDismiss: () => void }} props */
function Toast({ message, onDismiss }) {
  return (
    <div className="toast" role="status">
      <span className="toast-check" aria-hidden="true">✓</span>
      {message}
      <button type="button" className="icon-button" aria-label="Dismiss notification" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

/** @param {{ status: string }} props */
function StatusPill({ status }) {
  const configured = status === 'healthy';
  const warn = status === 'degraded' || status === 'not_configured';
  return (
    <span
      className={`ai-status-pill ${configured ? 'configured' : warn ? 'unconfigured' : ''}`}
    >
      <span className="status-dot" />{status.toUpperCase().replace('_', ' ')}
    </span>
  );
}

/** @param {{ component: import('react').ReactNode }} props */
function SettingsSection({ children }) {
  return (
    <section className="settings-section" aria-labelledby={null}>
      <div className="settings-section-card">{children}</div>
    </section>
  );
}

/** @param {{ title: string, eyebrow: string, description?: string, children: import('react').ReactNode }} props */
function SettingsPanel({ title, eyebrow, description, children }) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-top">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {description && <p className="settings-panel-desc">{description}</p>}
      <div className="settings-panel-body">{children}</div>
    </div>
  );
}

const DEFAULT_SETTINGS = {
  version: 1,
  general: {
    startup_behavior: 'show_home',
    default_project_directory: null,
    confirm_destructive_actions: true,
  },
  appearance: {
    theme: 'system',
    ui_density: 'comfortable',
  },
  editor: {
    font_size: 12,
    tab_size: 2,
    word_wrap: true,
    minimap: false,
    auto_save: false,
  },
  ai_provider: {
    provider: 'openai',
    model: 'gpt-5.4-mini',
  },
  terminal: {
    default_working_directory: null,
    output_retention_limit: 20,
    timeout_ms: 300000,
  },
  project_context: {
    max_file_size_mb: 1,
    indexing_enabled: true,
  },
  privacy: {
    telemetry_enabled: false,
  },
};

function deepEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((key) => deepEqual(a[key], b[key]));
}

export default function Settings() {
  const bridge = window.buildxDesktop;
  const [settings, setSettings] = useState(null);
  const [working, setWorking] = useState(false);
  const [, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState('');
  const [activeSection, setActiveSection] = useState('general');
  const [providerStatus, setProviderStatus] = useState(null);
  const [providerStatusLoading, setProviderStatusLoading] = useState(true);
  const [providerStatusError, setProviderStatusError] = useState('');
  const toastTimer = useRef(null);

  const localSettingsRef = useRef(localSettingsFromProps(settings));
  const [localSettings, setLocalSettings] = useState(localSettingsRef.current);

  // Re-hydrate local settings when the backend settings resolve (after loadSettings).
  useEffect(() => {
    if (!settings) return;
    setLocalSettings(localSettingsFromProps(settings));
    setDirty(false);
  }, [settings]);

  function localSettingsFromProps(s) {
    if (!s) return DEFAULT_SETTINGS;
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      general: { ...DEFAULT_SETTINGS.general, ...(s.general || {}) },
      appearance: { ...DEFAULT_SETTINGS.appearance, ...(s.appearance || {}) },
      editor: { ...DEFAULT_SETTINGS.editor, ...(s.editor || {}) },
      ai_provider: { ...DEFAULT_SETTINGS.ai_provider, ...(s.ai_provider || {}) },
      terminal: { ...DEFAULT_SETTINGS.terminal, ...(s.terminal || {}) },
      project_context: { ...DEFAULT_SETTINGS.project_context, ...(s.project_context || {}) },
      privacy: { ...DEFAULT_SETTINGS.privacy, ...(s.privacy || {}) },
    };
  }

  function mergeSection(section, values) {
    setLocalSettings((current) => ({
      ...current,
      [section]: { ...current[section], ...values },
    }));
  }

  const handleGeneralChange = useCallback(
    (section, values) => mergeSection(section, values),
    []
  );
  const handleAppearanceChange = useCallback(
    (section, values) => mergeSection(section, values),
    []
  );
  const handleEditorChange = useCallback((section, values) => mergeSection(section, values), []);
  const handleTerminalChange = useCallback((section, values) => mergeSection(section, values), []);
  const handleProjectContextChange = useCallback(
    (section, values) => mergeSection(section, values),
    []
  );
  const handlePrivacyChange = useCallback((section, values) => mergeSection(section, values), []);

  useEffect(() => {
    loadSettings();
    loadProviderStatus();
  }, []);

  useEffect(() => {
    return () => window.clearTimeout(toastTimer.current);
  }, []);

  function notify(message) {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2800);
  }

  async function loadSettings() {
    if (!bridge || typeof bridge.getSettings !== 'function') {
      setError('The desktop settings bridge is unavailable. Restart BUILDX.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      const result = await bridge.getSettings();
      setSettings(result);
      setDirty(false);
    } catch (loadError) {
      setError(loadError.message || 'BUILDX could not load settings.');
    } finally {
      setWorking(false);
    }
  }

  async function loadProviderStatus() {
    if (!bridge || typeof bridge.getAIStatus !== 'function') {
      setProviderStatusError('The desktop settings bridge is unavailable. Restart BUILDX.');
      setProviderStatusLoading(false);
      return;
    }
    setProviderStatusLoading(true);
    setProviderStatusError('');
    try {
      const result = await bridge.getAIStatus();
      setProviderStatus(result);
    } catch (loadError) {
      setProviderStatusError(loadError.message || 'BUILDX could not read AI provider status.');
    } finally {
      setProviderStatusLoading(false);
    }
  }

  async function saveSettings() {
    if (!bridge || typeof bridge.patchSettings !== 'function') {
      setError('The desktop settings bridge is unavailable. Restart BUILDX.');
      return;
    }
    const patch = {
      general: localSettings.general,
      appearance: localSettings.appearance,
      editor: localSettings.editor,
      ai_provider: localSettings.ai_provider,
      terminal: localSettings.terminal,
      project_context: localSettings.project_context,
      privacy: localSettings.privacy,
    };
    setWorking(true);
    setError('');
    try {
      const result = await bridge.patchSettings(patch);
      setSettings(result);
      setDirty(false);
      notify('Settings saved.');
    } catch (saveError) {
      setError(saveError.message || 'BUILDX could not save settings. Your changes are still pending.');
    } finally {
      setWorking(false);
    }
  }

  async function resetSettings() {
    if (!bridge || typeof bridge.resetSettings !== 'function') {
      setError('The desktop settings bridge is unavailable. Restart BUILDX.');
      return;
    }
    setWorking(true);
    setResetConfirm(false);
    setError('');
    try {
      const result = await bridge.resetSettings();
      setSettings(result);
      setDirty(false);
      notify('Settings reset to defaults.');
    } catch (resetError) {
      setError(resetError.message || 'BUILDX could not reset settings.');
    } finally {
      setWorking(false);
    }
  }

  async function loadHealth() {
    if (!bridge || typeof bridge.getSettingsHealth !== 'function') {
      setHealthError('The desktop health bridge is unavailable. Restart BUILDX.');
      return;
    }
    setHealthLoading(true);
    setHealthError('');
    try {
      const result = await bridge.getSettingsHealth();
      setHealth(result);
    } catch (healthError) {
      setHealthError(healthError.message || 'BUILDX could not load health status.');
    } finally {
      setHealthLoading(false);
    }
  }

  const isDirty = useMemo(
    () => !deepEqual(localSettings, settings || DEFAULT_SETTINGS),
    [localSettings, settings],
  );

  async function testAIConnection() {
    if (!bridge || typeof bridge.testAIConnection !== 'function') {
      setProviderStatusError('The desktop settings bridge is unavailable. Restart BUILDX.');
      return;
    }
    setProviderStatusLoading(true);
    setProviderStatusError('');
    try {
      const result = await bridge.testAIConnection();
      setProviderStatus((current) => ({ ...current, connection_status: result.success ? 'healthy' : 'not_configured' }));
      notify(result.success ? 'AI provider connection test passed.' : `Connection test failed: ${result.message}`);
    } catch (testError) {
      setProviderStatusError(testError.message || 'The AI connection test failed. Retry it.');
    } finally {
      setProviderStatusLoading(false);
    }
  }

  return (
    <section className="settings-view" aria-label="BUILDX settings">
      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
      {error && (
        <div className="settings-error" role="alert">
          <span>{error}</span>
          <button className="quiet-button" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      <div className="settings-heading">
        <span className="eyebrow">BUILDX SETTINGS</span>
        <h1>Settings</h1>
        <p className="settings-heading-note">
          Preferences are stored locally on this device and survive restarts. Sensitive AI
          credentials are managed in the backend <code>backend/.env</code> file and are never
          shown or stored on this screen.
        </p>
      </div>

      <nav className="settings-tabs">
        {SETTINGS_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`settings-tab ${section.id === activeSection ? 'active' : ''}`}
            onClick={() => setActiveSection(section.id)}
            aria-selected={section.id === activeSection}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <div className="settings-content">
        <GeneralSection
          settings={localSettings}
          onChange={handleGeneralChange}
          working={working}
          saveSettings={saveSettings}
          isDirty={isDirty}
        />
        <AppearanceSection settings={localSettings} onChange={handleAppearanceChange} />
        <EditorSection settings={localSettings} onChange={handleEditorChange} />
        <AIProviderSection
          status={providerStatus}
          loading={providerStatusLoading}
          error={providerStatusError}
          onTestConnection={testAIConnection}
        />
        <TerminalSection settings={localSettings} onChange={handleTerminalChange} />
        <ProjectContextSection
          settings={localSettings}
          onChange={handleProjectContextChange}
        />
        <PrivacySection settings={localSettings} onChange={handlePrivacyChange} />
        <HealthDashboard
          health={health}
          loading={healthLoading}
          error={healthError}
          onRefresh={loadHealth}
        />
      </div>

      <div className="settings-actions">
        <button
          type="button"
          className="button quiet-button"
          onClick={() => setResetConfirm(true)}
          disabled={working}
        >
          Reset all to defaults
        </button>
        <button
          type="button"
          className="button primary-button"
          onClick={saveSettings}
          disabled={working || !isDirty}
        >
          {working ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {resetConfirm && (
        <div className="modal-backdrop">
          <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-title">
            <div className="dialog-top">
              <span className="dialog-kicker">RESET SETTINGS</span>
              <button type="button" className="icon-button" aria-label="Cancel reset" onClick={() => setResetConfirm(false)}>
                ×
              </button>
            </div>
            <h2 id="reset-title">Reset all settings to defaults?</h2>
            <p>
              This restores every preference to its safe default and cannot be undone. AI provider
              credentials in <code>backend/.env</code> are not affected.
            </p>
            <div className="dialog-actions">
              <button className="button quiet-button" onClick={() => setResetConfirm(false)} disabled={working}>
                Cancel
              </button>
              <button
                className="button danger-button"
                onClick={resetSettings}
                disabled={working}
              >
                {working ? 'Resetting…' : 'Reset all'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section change handlers
// ---------------------------------------------------------------------------

function GeneralSection({ settings, onChange, working, saveSettings, isDirty }) {
  const [startup, setStartup] = useState(settings.general.startup_behavior);
  const [directory, setDirectory] = useState(settings.general.default_project_directory || '');
  const [confirm, setConfirm] = useState(settings.general.confirm_destructive_actions);

  useEffect(() => {
    setStartup(settings.general.startup_behavior);
    setDirectory(settings.general.default_project_directory || '');
    setConfirm(settings.general.confirm_destructive_actions);
  }, [settings.general]);

  const handleStartup = useCallback((v) => { setStartup(v); onChange('general', { startup_behavior: v }); }, [onChange]);
  const handleDirectory = useCallback((v) => { setDirectory(v); onChange('general', { default_project_directory: v || null }); }, [onChange]);
  const handleConfirm = useCallback((v) => { setConfirm(v); onChange('general', { confirm_destructive_actions: v }); }, [onChange]);

  return (
    <SettingsSection>
      <SettingsPanel
        title="General"
        eyebrow="Application startup"
        description="Startup behavior, default project directory, and confirmation preferences for destructive actions."
      >
        <Select
          name="startup_behavior"
          value={startup}
          onChange={handleStartup}
          options={STARTUP_BEHAVIORS}
          label="Startup behavior"
        />
        <TextInput
          id="settings-default-directory"
          value={directory}
          onChange={handleDirectory}
          label="Default project directory"
          placeholder="Choose a folder…"
          maxLength={4096}
        />
        <p className="settings-caption">
          The default directory is a preference only; filesystem access still requires project
          folder confirmation through the native picker (Phase 6).
        </p>
        <Checkbox
          id="settings-confirm-destructive"
          label="Confirm destructive actions"
          checked={confirm}
          onChange={handleConfirm}
          description="Require confirmation before deleting files, projects, or discarding edits."
        />
        <div className="settings-actions-row">
          <button
            type="button"
            className="button quiet-button"
            onClick={() => {
              setStartup('show_home');
              setDirectory('');
              setConfirm(true);
              onChange('general', {
                startup_behavior: 'show_home',
                default_project_directory: null,
                confirm_destructive_actions: true,
              });
            }}
            disabled={working}
          >
            Reset section to defaults
          </button>
          {isDirty && (
            <button type="button" className="button primary-button" onClick={saveSettings} disabled={working}>
              Save settings
            </button>
          )}
        </div>
      </SettingsPanel>
    </SettingsSection>
  );
}

function AppearanceSection({ settings, onChange }) {
  const [theme, setTheme] = useState(settings.appearance.theme);
  const [density, setDensity] = useState(settings.appearance.ui_density);

  useEffect(() => {
    setTheme(settings.appearance.theme);
    setDensity(settings.appearance.ui_density);
  }, [settings.appearance]);

  const handleTheme = useCallback((v) => { setTheme(v); onChange('appearance', { theme: v }); }, [onChange]);
  const handleDensity = useCallback((v) => { setDensity(v); onChange('appearance', { ui_density: v }); }, [onChange]);

  return (
    <SettingsSection>
      <SettingsPanel
        title="Appearance"
        eyebrow="Visual preferences"
        description="Theme and UI density. BUILDX currently renders a dark interface; the Light selection is stored and applied when a light theme is added in a later phase."
      >
        <Select
          name="theme"
          value={theme}
          onChange={handleTheme}
          options={THEMES}
          label="Theme"
        />
        <p className="settings-caption">
          System follows your operating system preference and renders the dark theme in this phase.
        </p>
        <Select
          name="ui_density"
          value={density}
          onChange={handleDensity}
          options={UI_DENSITIES}
          label="UI density"
        />
      </SettingsPanel>
    </SettingsSection>
  );
}

function EditorSection({ settings, onChange }) {
  const [fontSize, setFontSize] = useState(String(settings.editor.font_size));
  const [tabSize, setTabSize] = useState(String(settings.editor.tab_size));
  const [wordWrap, setWordWrap] = useState(settings.editor.word_wrap);
  const [minimap, setMinimap] = useState(settings.editor.minimap);
  const [autoSave, setAutoSave] = useState(settings.editor.auto_save);

  useEffect(() => {
    setFontSize(String(settings.editor.font_size));
    setTabSize(String(settings.editor.tab_size));
    setWordWrap(settings.editor.word_wrap);
    setMinimap(settings.editor.minimap);
    setAutoSave(settings.editor.auto_save);
  }, [settings.editor]);

  return (
    <SettingsSection>
      <SettingsPanel
        title="Editor"
        eyebrow="Code editor behavior"
        description="Preferences applied by the CodeMirror editor where supported by the current editor implementation."
      >
        <TextInput
          id="settings-font-size"
          value={fontSize}
          onChange={(v) => {
            setFontSize(v);
            const n = Number(v);
            if (Number.isInteger(n) && n >= 8 && n <= 72) {
              onChange('editor', { font_size: n });
            }
          }}
          label="Font size (px)"
          placeholder="12"
          maxLength={3}
        />
        <TextInput
          id="settings-tab-size"
          value={tabSize}
          onChange={(v) => {
            setTabSize(v);
            const n = Number(v);
            if (Number.isInteger(n) && n >= 1 && n <= 16) {
              onChange('editor', { tab_size: n });
            }
          }}
          label="Tab size (spaces)"
          placeholder="2"
          maxLength={2}
        />
        <Checkbox
          id="settings-word-wrap"
          label="Word wrap"
          checked={wordWrap}
          onChange={(v) => { setWordWrap(v); onChange('editor', { word_wrap: v }); }}
        />
        <Checkbox
          id="settings-minimap"
          label="Minimap"
          checked={minimap}
          onChange={(v) => { setMinimap(v); onChange('editor', { minimap: v }); }}
          description="Not rendered by the current editor; stored for a later phase."
        />
        <Checkbox
          id="settings-auto-save"
          label="Auto-save"
          checked={autoSave}
          onChange={(v) => { setAutoSave(v); onChange('editor', { auto_save: v }); }}
          description="When enabled, open files save automatically. Files over 1 MiB remain unavailable to edit."
        />
        <p className="settings-caption">
          Auto-save is off by default. Unsaved edits are protected by save-before-close prompts.
        </p>
      </SettingsPanel>
    </SettingsSection>
  );
}

function AIProviderSection({ status, loading, error, onTestConnection }) {
  const configured = Boolean(status?.credential_available);
  return (
    <SettingsSection>
      <SettingsPanel
        title="AI provider"
        eyebrow="Provider connection"
        description="BUILDX uses OpenAI through its official SDK. The credential lives in backend configuration and is never shown or stored on this screen."
      >
        <div className="ai-provider-card">
          <div className="ai-provider-card-top">
            <div>
              <span className="panel-index">ACTIVE PROVIDER</span>
              <h2>OpenAI</h2>
            </div>
            {loading ? (
              <span className="ai-status-pill">
                <span className="status-dot" />CHECKING…
              </span>
            ) : (
              <span
                className={`ai-status-pill ${
                  configured ? 'configured' : 'unconfigured'
                }`}
              >
                <span className="status-dot" />
                {configured ? 'CONFIGURED' : 'NOT CONFIGURED'}
              </span>
            )}
          </div>

          {error && (
            <div className="ai-feedback ai-error" role="alert">
              <p>{error}</p>
            </div>
          )}

          {!loading && (
            <dl className="ai-provider-details">
              <div>
                <dt>Provider</dt>
                <dd>{status?.provider_id || 'OpenAI'} (only provider implemented)</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{status?.model_id || 'gpt-5.4-mini'}</dd>
              </div>
              <div>
                <dt>Credential</dt>
                <dd>
                  {configured ? 'Available on backend' : 'Not configured'}
                </dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>
                  {status?.connection_status === 'not_tested'
                    ? 'Not tested yet'
                    : status?.connection_status === 'missing_credentials'
                    ? 'Not configured'
                    : status?.connection_status === 'healthy'
                    ? 'Test passed'
                    : status?.connection_status}
                </dd>
              </div>
            </dl>
          )}

          {!configured && !loading && !error && (
            <p className="ai-feedback">
              Add <code>BUILDX_OPENAI_API_KEY</code> to the backend
              <code>.env</code> file, then restart BUILDX. The credential stays on the backend
              and is never sent to this screen.
            </p>
          )}
          {configured && !loading && !error && (
            <>
              <p className="ai-feedback">
                The credential stays on the backend and is never sent to this screen. Change it
                by editing <code>BUILDX_OPENAI_API_KEY</code> in <code>backend/.env</code>, then
                restart BUILDX.
              </p>
              <button
                className="button primary-button"
                type="button"
                onClick={onTestConnection}
                disabled={!onTestConnection}
              >
                {loading ? 'Testing connection…' : 'Test connection'} <span aria-hidden="true">→</span>
              </button>
              <p className="settings-caption">
                Credentials are managed in backend/.env on the backend. Clearing requires editing
                that file and restarting BUILDX; no credential ever passes through this UI.
              </p>
            </>
          )}
        </div>
        <p className="settings-caption">
          Provider connectivity is checked through the existing backend connection-test endpoint.
          A test makes one short request and may incur a small provider API charge.
        </p>
      </SettingsPanel>
    </SettingsSection>
  );
}

function TerminalSection({ settings, onChange }) {
  const [directory, setDirectory] = useState(settings.terminal.default_working_directory || '');
  const [retention, setRetention] = useState(String(settings.terminal.output_retention_limit));
  const [timeout, setTimeout] = useState(String(settings.terminal.timeout_ms));

  useEffect(() => {
    setDirectory(settings.terminal.default_working_directory || '');
    setRetention(String(settings.terminal.output_retention_limit));
    setTimeout(String(settings.terminal.timeout_ms));
  }, [settings.terminal]);

  const handleDirectory = useCallback((v) => {
    setDirectory(v);
    onChange('terminal', { default_working_directory: v || null });
  }, [onChange]);
  const handleRetention = useCallback((v) => {
    setRetention(v);
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 200) {
      onChange('terminal', { output_retention_limit: n });
    }
  }, [onChange]);
  const handleTimeout = useCallback((v) => {
    setTimeout(v);
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1000 && n <= 1800000) {
      onChange('terminal', { timeout_ms: n });
    }
  }, [onChange]);

  return (
    <SettingsSection>
      <SettingsPanel
        title="Terminal"
        eyebrow="Terminal and process management"
        description="Terminal preferences. Command approval from Phase 13 remains enforced for every command; settings cannot bypass it."
      >
        <TextInput
          id="settings-terminal-directory"
          value={directory}
          onChange={handleDirectory}
          label="Default working directory"
          placeholder="Restricted to approved project paths"
          maxLength={4096}
        />
        <p className="settings-caption">
          The default directory is a preference only; each command still runs within the currently
          authorized project folder with explicit review.
        </p>
        <TextInput
          id="settings-retention"
          value={retention}
          onChange={handleRetention}
          label="Output retention (completed sessions)"
          placeholder="20"
          maxLength={3}
        />
        <p className="settings-caption">
          The last 20 completed sessions are kept in memory by default (1–200).
        </p>
        <TextInput
          id="settings-timeout"
          value={timeout}
          onChange={handleTimeout}
          label="Default timeout (ms)"
          placeholder="300000"
          maxLength={7}
        />
        <p className="settings-caption">
          Five minutes (300000 ms) by default (1,000–1,800,000 ms).
        </p>
      </SettingsPanel>
    </SettingsSection>
  );
}

function ProjectContextSection({ settings, onChange }) {
  const [maxFileSize, setMaxFileSize] = useState(String(settings.project_context.max_file_size_mb));
  const [indexing, setIndexing] = useState(settings.project_context.indexing_enabled);

  useEffect(() => {
    setMaxFileSize(String(settings.project_context.max_file_size_mb));
    setIndexing(settings.project_context.indexing_enabled);
  }, [settings.project_context]);

  return (
    <SettingsSection>
      <SettingsPanel
        title="Project Context"
        eyebrow="Indexing limits"
        description="Project context indexing honors Phase 10 security boundaries; preferences cannot bypass them."
      >
        <TextInput
          id="settings-max-file-size"
          value={maxFileSize}
          onChange={(v) => {
            setMaxFileSize(v);
            const n = Number(v);
            if (Number.isInteger(n) && n >= 1 && n <= 1024) {
              onChange('project_context', { max_file_size_mb: n });
            }
          }}
          label="Maximum indexed file size (MiB)"
          placeholder="1"
          maxLength={4}
        />
        <p className="settings-caption">
          Files over 1 MiB remain unavailable to edit and are excluded from the index.
        </p>
        <Checkbox
          id="settings-indexing-enabled"
          label="Project context indexing enabled"
          checked={indexing}
          onChange={(v) => { setIndexing(v); onChange('project_context', { indexing_enabled: v }); }}
        />
        <p className="settings-caption">
          Indexing honors root and nested .gitignore rules and excludes sensitive paths and
          binary files. It is local lexical search, not semantic or vector search.
        </p>
      </SettingsPanel>
    </SettingsSection>
  );
}

function PrivacySection({ settings, onChange }) {
  const [telemetry, setTelemetry] = useState(settings.privacy.telemetry_enabled);

  useEffect(() => {
    setTelemetry(settings.privacy.telemetry_enabled);
  }, [settings.privacy]);

  return (
    <SettingsSection>
      <SettingsPanel
        title="Privacy"
        eyebrow="Data and communication"
        description="BUILDX is local-first. Project metadata, plans, indexed text, and conversation history are stored in local SQLite."
      >
        <div className="privacy-facts">
          <div>
            <strong>Stored locally:</strong>
            <ul className="privacy-list">
              <li>Project records, descriptions, and directory associations</li>
              <li>Project plans and change proposals</li>
              <li>Indexed file chunks and conversation history</li>
              <li>Settings preferences (this screen)</li>
            </ul>
          </div>
          <div>
            <strong>Sent externally:</strong>
            <ul className="privacy-list">
              <li>Only when you use AI features, to the configured OpenAI provider</li>
              <li>Bounded project excerpts (up to 6,000 characters) and recent history</li>
              <li>Provider-side storage is disabled (<code>store=False</code>)</li>
            </ul>
          </div>
        </div>
        <Checkbox
          id="settings-telemetry"
          label="Optional telemetry"
          checked={telemetry}
          onChange={(v) => { setTelemetry(v); onChange('privacy', { telemetry_enabled: v }); }}
          description="Off by default. No telemetry is collected unless you enable it here."
        />
        <p className="settings-caption">
          SQLite is not encrypted by BUILDX; protect your OS account and local data directory.
          Credentials never leave the backend.
        </p>
      </SettingsPanel>
    </SettingsSection>
  );
}

function HealthDashboard({ health, loading, error, onRefresh }) {
  const components = useMemo(() => (health && health.components) || [], [health]);

  return (
    <SettingsSection>
      <SettingsPanel
        title="Operational Health"
        eyebrow="System status"
        description="Accurate status for the components that actually exist. Refresh on demand; no automatic polling."
      >
        <div className="health-toolbar">
          <button
            type="button"
            className="button quiet-button"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh status'}
          </button>
          {error && (
            <span className="settings-caption health-error">{error}</span>
          )}
        </div>
        {loading && <p className="settings-caption" role="status">Checking component health…</p>}
        {!loading && components.length > 0 && (
          <>
            <div className="health-list">
              {components.map((component) => (
                <div key={component.name} className="health-row">
                  <div className="health-row-info">
                    <strong>{component.name}</strong>
                    <span className="health-row-message">{component.message}</span>
                  </div>
                  <div className="health-row-status">
                    <StatusPill status={component.status} />
                    {component.retry_available && (
                      <button
                        type="button"
                        className="button quiet-button"
                        onClick={onRefresh}
                        size="small"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="health-overall">
              <strong>Overall:</strong>{' '}
              <span className={`health-status-${health.overall}`}>{health.overall.toUpperCase().replace('_', ' ')}</span>{' '}
              · checked {new Date(health.checked_at).toLocaleTimeString()}
            </div>
          </>
        )}
      </SettingsPanel>
    </SettingsSection>
  );
}
