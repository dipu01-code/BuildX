import React, { useEffect, useState } from 'react';

export default function AISettings() {
  const [providerStatus, setProviderStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [testResult, setTestResult] = useState(null);

  async function loadStatus() {
    setIsLoading(true);
    setLoadError('');
    try {
      const result = await window.buildxDesktop.getAIStatus();
      setProviderStatus(result);
      setTestResult(null);
    } catch (error) {
      setLoadError(error.message || 'BUILDX could not read AI provider status.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { loadStatus(); }, []);

  async function testConnection() {
    if (isTesting || !providerStatus?.credential_available) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      setTestResult(await window.buildxDesktop.testAIConnection());
    } catch (error) {
      setTestResult({ success: false, message: error.message || 'The connection test failed. Retry it.' });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <section className="ai-settings" aria-labelledby="ai-settings-title">
      <div className="ai-settings-heading">
        <span className="eyebrow">PROVIDER CONNECTION</span>
        <h1 id="ai-settings-title">AI provider</h1>
        <p>Connect BUILDX to OpenAI for future AI features. This phase only checks the connection; it does not send project files.</p>
      </div>

      <div className="ai-provider-card">
        <div className="ai-provider-card-top">
          <div><span className="panel-index">ACTIVE PROVIDER</span><h2>OpenAI</h2></div>
          {!isLoading && providerStatus && <span className={`ai-status-pill ${providerStatus.credential_available ? 'configured' : 'unconfigured'}`}>
            <span className="status-dot" />{providerStatus.credential_available ? (testResult?.success ? 'CONNECTED' : 'CONFIGURED') : 'NOT CONNECTED'}
          </span>}
        </div>

        {isLoading ? <p className="ai-feedback" role="status">Loading provider status…</p>
          : loadError ? <div className="ai-feedback ai-error" role="alert"><p>{loadError}</p><button className="text-button" onClick={loadStatus}>Retry status check →</button></div>
            : <>
              <dl className="ai-provider-details">
                <div><dt>Model</dt><dd>{providerStatus.model_id}</dd></div>
                <div><dt>Credential</dt><dd>{providerStatus.credential_available ? 'Available on backend' : 'Not configured'}</dd></div>
                <div><dt>Connection</dt><dd>{testResult?.success ? 'Test passed' : testResult && !testResult.success ? 'Test failed' : providerStatus.connection_status === 'not_tested' ? 'Not tested yet' : 'Not configured'}</dd></div>
              </dl>

              {!providerStatus.credential_available && <p className="ai-feedback">Add <code>BUILDX_OPENAI_API_KEY</code> to the backend <code>.env</code> file, then restart BUILDX. The credential stays on the backend and is never sent to this screen.</p>}
              {testResult?.success && <p className="ai-result-success" role="status">Connection test passed in {testResult.duration_ms} ms. Provider reply: “{testResult.response_text}”</p>}
              {testResult && !testResult.success && <p className="ai-result-error" role="alert">{testResult.message}</p>}
              <div className="ai-provider-actions">
                <button className="button primary-button" type="button" onClick={testConnection} disabled={!providerStatus.credential_available || isTesting}>
                  {isTesting ? 'Testing connection…' : testResult && !testResult.success ? 'Retry connection test' : 'Test connection'} <span aria-hidden="true">→</span>
                </button>
              </div>
            </>}
      </div>
      <p className="ai-cost-note">A successful connection test makes one short request and may incur a small provider API charge. BUILDX does not save the test prompt or response.</p>
    </section>
  );
}
