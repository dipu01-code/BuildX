import React, { Component, useEffect, useState } from 'react';

class RendererErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="error-screen" role="alert">
          <span className="eyebrow">BUILDX / STARTUP</span>
          <h1>Something interrupted startup.</h1>
          <p>Close and reopen BUILDX. If the problem continues, check the development log.</p>
        </main>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const [appInfo, setAppInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;
    const bridge = window.buildxDesktop;

    if (!bridge || typeof bridge.getAppInfo !== 'function') {
      setError('The desktop bridge is unavailable. Restart BUILDX to reconnect.');
      return () => { isMounted = false; };
    }

    bridge.getAppInfo().then((info) => {
      if (isMounted) setAppInfo(info);
    }).catch(() => {
      if (isMounted) setError('BUILDX could not read desktop runtime information.');
    });

    return () => { isMounted = false; };
  }, []);

  return (
    <main className="app-frame">
      <header className="topbar">
        <a className="wordmark" href="#main" aria-label="BUILDX home">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span>buildx</span>
        </a>
        <div className="topbar-meta">
          <span className="phase-label"><span className="status-dot" /> Desktop foundation</span>
          <span className="meta-divider" aria-hidden="true" />
          <span className="version-label">{appInfo ? `v${appInfo.version}` : 'Starting…'}</span>
        </div>
      </header>

      <section className="welcome" id="main" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <span className="eyebrow">A calmer place to make software</span>
          <h1 id="welcome-title" aria-label="Build with more clarity.">Build with<br /><span>more clarity.</span></h1>
          <p className="welcome-description">
            Your workspace is taking shape. BUILDX will bring your projects, plans, and code into one focused desktop environment.
          </p>
        </div>

        <div className="foundation-card" aria-live="polite">
          <div className="card-heading">
            <span className="card-icon" aria-hidden="true">✳</span>
            <div>
              <span className="card-kicker">SYSTEM CHECK</span>
              <h2>{error ? 'Needs attention' : appInfo ? 'You’re all set' : 'Warming up'}</h2>
            </div>
          </div>
          {error ? (
            <p className="card-message error-message" role="alert">{error}</p>
          ) : (
            <>
              <p className="card-message">
                {appInfo
                  ? `BUILDX ${appInfo.version} is running on ${appInfo.platform}. The desktop renderer is connected.`
                  : 'Connecting the desktop interface to its secure runtime…'}
              </p>
              <div className="check-row">
                <span className="check-indicator" aria-hidden="true">✓</span>
                <span>Secure desktop bridge</span>
                <span className="check-state">{appInfo ? 'READY' : 'CHECKING'}</span>
              </div>
              <div className="check-row muted-row">
                <span className="pending-indicator" aria-hidden="true">·</span>
                <span>Project services</span>
                <span className="check-state">NEXT PHASE</span>
              </div>
            </>
          )}
        </div>
      </section>

      <footer className="footer-bar">
        <span>LOCAL FIRST <span className="footer-separator">/</span> YOUR WORK STAYS YOURS</span>
        <span className="footer-right">BUILDX <span className="footer-separator">·</span> EARLY FOUNDATION</span>
      </footer>
    </main>
  );
}

export default function App() {
  return (
    <RendererErrorBoundary>
      <AppContent />
    </RendererErrorBoundary>
  );
}
