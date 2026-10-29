import React, { useEffect, useMemo, useState } from 'react';

const DEFAULT_LIMITS = { timeoutMs: 5 * 60 * 1000, maxConcurrent: 2, maxOutputBytes: 512 * 1024 };
const DESTRUCTIVE_COMMAND = /(?:\brm\s+-[^\n]*r[^\n]*f\b|\bsudo\b|\bmkfs(?:\.[\w-]+)?\b|\bshutdown\b|\bformat\s+[a-z]:|\bgit\s+reset\s+--hard\b|\bdrop\s+database\b|\bdel\s+\/s\b)/i;

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function statusLabel(value) {
  return ({ running: 'Running', succeeded: 'Succeeded', failed: 'Failed', terminated: 'Terminated', timed_out: 'Timed out' })[value] || value;
}

function addOutput(current, stream, data, maximum) {
  const next = { ...current, [stream]: `${current[stream] || ''}${data}` };
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const byteLength = (value) => encoder.encode(value).byteLength;
  let bytes = byteLength(next.stdout || '') + byteLength(next.stderr || '') + byteLength(next.system || '');
  if (bytes > maximum) {
    let remaining = maximum;
    for (const key of ['stdout', 'stderr', 'system']) {
      const value = next[key] || '';
      const clipped = decoder.decode(encoder.encode(value).subarray(0, remaining));
      next[key] = clipped;
      remaining -= byteLength(clipped);
    }
  }
  return next;
}

export default function TerminalPanel({ project }) {
  const [command, setCommand] = useState('');
  const [review, setReview] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [outputs, setOutputs] = useState({});
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [clearCount, setClearCount] = useState(0);

  const selected = sessions.find((session) => session.id === selectedId) || sessions[0] || null;
  const isReviewed = Boolean(review && review.command === command && review.project_id === project.id
    && review.working_directory === project.root_path);
  const requiresWarning = Boolean(isReviewed && DESTRUCTIVE_COMMAND.test(review.command));
  const activeCount = sessions.filter((session) => session.status === 'running').length;
  const currentOutput = outputs[selected?.id] || { stdout: '', stderr: '', system: '' };
  const startedAt = selected?.started_at ? Date.parse(selected.started_at) : now;
  const elapsed = selected?.status === 'running' ? Math.max(0, now - startedAt) : (selected?.elapsed_ms || 0);
  const sessionsForProject = useMemo(() => sessions.filter((session) => session.project_id === project.id), [sessions, project.id]);

  useEffect(() => {
    let mounted = true;
    const mergeSessions = (incoming) => setSessions((current) => {
      const byId = new Map(current.map((session) => [session.id, session]));
      for (const session of incoming) {
        const old = byId.get(session.id);
        if (!old || (session.ended_at && (!old.ended_at || Date.parse(session.ended_at) >= Date.parse(old.ended_at)))
          || (old.status === 'running' && session.status !== 'running')) byId.set(session.id, session);
      }
      return [...byId.values()].filter((session) => session.project_id === project.id)
        .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at));
    });
    window.buildxDesktop.listTerminalProcesses(project.id).then((result) => {
      if (!mounted) return;
      setLimits(result.limits || DEFAULT_LIMITS);
      mergeSessions(result.sessions || []);
      for (const session of result.sessions || []) setOutputs((current) => current[session.id] ? current : {
        ...current, [session.id]: { stdout: session.stdout || '', stderr: session.stderr || '', system: '' },
      });
      if (result.sessions?.length) setSelectedId((current) => current || result.sessions[0].id);
    }).catch((loadError) => { if (mounted) setError(loadError.message || 'Terminal process history could not be loaded.'); });
    const unsubscribe = window.buildxDesktop.onTerminalEvent((event) => {
      if (!mounted || event.project_id !== project.id) return;
      if (event.type === 'status' && event.session) {
        mergeSessions([event.session]);
        setOutputs((current) => current[event.session.id] ? current : {
          ...current, [event.session.id]: { stdout: event.session.stdout || '', stderr: event.session.stderr || '', system: '' },
        });
        setSelectedId((current) => current || event.session.id);
      } else if (event.type === 'output' && typeof event.data === 'string') {
        setOutputs((current) => ({
          ...current,
          [event.session_id]: addOutput(current[event.session_id] || { stdout: '', stderr: '', system: '' }, event.stream, event.data, limits.maxOutputBytes),
        }));
      } else if (event.type === 'stop_requested') {
        setOutputs((current) => ({ ...current, [event.session_id]: addOutput(current[event.session_id] || {}, 'system', 'Stop requested; waiting for process confirmation.\n', limits.maxOutputBytes) }));
      } else if (event.type === 'timeout_requested') {
        setOutputs((current) => ({ ...current, [event.session_id]: addOutput(current[event.session_id] || {}, 'system', 'Time limit reached; stopping process.\n', limits.maxOutputBytes) }));
      }
    });
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted = false; window.clearInterval(timer); unsubscribe?.(); };
  }, [project.id, limits.maxOutputBytes]);

  function reviewCommand(event) {
    event.preventDefault();
    if (!command.trim() || command.length > 4000 || busy || !project.root_path) return;
    setReview({ command, project_id: project.id, working_directory: project.root_path, request_id: crypto.randomUUID() });
    setError('');
  }

  async function runReviewedCommand() {
    if (!isReviewed || !review || busy || activeCount >= limits.maxConcurrent) return;
    if (requiresWarning && !window.confirm('This command matches a potentially destructive pattern. BUILDX cannot fully determine its effects. Run it only if you understand what it will do.')) return;
    setBusy(true); setError('');
    try {
      const session = await window.buildxDesktop.startTerminalProcess(project.id, {
        command: review.command, request_id: review.request_id,
        approval: { project_id: review.project_id, command: review.command, working_directory: review.working_directory },
      });
      setSessions((current) => {
        const existing = current.find((item) => item.id === session.id);
        const newest = existing && existing.status !== 'running' ? existing : session;
        return [newest, ...current.filter((item) => item.id !== session.id)];
      });
      setOutputs((current) => current[session.id] ? current : ({ ...current, [session.id]: { stdout: session.stdout || '', stderr: session.stderr || '', system: '' } }));
      setSelectedId(session.id); setCommand(''); setReview(null);
    } catch (startError) { setError(startError.message || 'The command could not be started.'); }
    finally { setBusy(false); }
  }

  async function stopSelected() {
    if (!selected || selected.status !== 'running' || busy) return;
    setBusy(true); setError('');
    try { await window.buildxDesktop.stopTerminalProcess(project.id, selected.id); }
    catch (stopError) { setError(stopError.message || 'The process could not be stopped.'); }
    finally { setBusy(false); }
  }

  function clearOutput() {
    if (!selected) return;
    setOutputs((current) => ({ ...current, [selected.id]: { stdout: '', stderr: '', system: '' } }));
    setClearCount((count) => count + 1);
  }

  return <section className="terminal-panel" aria-label="Project terminal">
    <header className="terminal-heading"><div><span className="eyebrow">PROJECT TERMINAL</span><h2>Run a command</h2><p>Working directory: <code>{project.root_path || 'Choose a project folder to continue'}</code></p></div>
      <div className="terminal-limits">Timeout {Math.round(limits.timeoutMs / 60000)} min · {limits.maxConcurrent} concurrent · {Math.round(limits.maxOutputBytes / 1024)} KiB output/session</div></header>
    {error && <div role="alert" className="terminal-error">{error}</div>}
    <form className="terminal-command-form" onSubmit={reviewCommand}>
      <label htmlFor="terminal-command">Command</label>
      <textarea id="terminal-command" rows={3} maxLength={4000} value={command} onChange={(event) => setCommand(event.target.value)} placeholder="For example: npm run dev" disabled={!project.root_path || busy} />
      <div className="terminal-command-actions"><span>Commands run in a system shell with a filtered environment; this is not a security sandbox.</span>
        <button className="button quiet-button" type="submit" disabled={!command.trim() || busy || !project.root_path}>Review command</button></div>
    </form>
    {review && <section className="terminal-review" aria-label="Command approval review">
      <h3>Review before running</h3><dl><dt>Project</dt><dd>{project.name}</dd><dt>Directory</dt><dd><code>{review.working_directory}</code></dd><dt>Command</dt><dd><pre>{review.command}</pre></dd></dl>
      {!isReviewed ? <p role="alert">The command or project directory changed. Review the updated command before running it.</p>
        : <button type="button" className="button primary-button" onClick={runReviewedCommand} disabled={busy || activeCount >= limits.maxConcurrent || !project.root_path}>{requiresWarning ? 'Confirm potentially destructive command' : 'Run approved command'}</button>}
      <button type="button" className="button quiet-button" onClick={() => setReview(null)} disabled={busy}>Cancel review</button>
    </section>}
    <div className="terminal-process-bar"><label htmlFor="terminal-session">Process sessions</label>
      <select id="terminal-session" value={selected?.id || ''} onChange={(event) => setSelectedId(event.target.value)} disabled={!sessionsForProject.length}>
        {!sessionsForProject.length && <option value="">No commands run yet</option>}
        {sessionsForProject.map((session) => <option key={session.id} value={session.id}>{statusLabel(session.status)} · {session.command.slice(0, 72)}</option>)}
      </select>
      <span className={`terminal-status ${selected?.status || 'idle'}`} role="status">{selected ? `${statusLabel(selected.status)} · ${formatDuration(elapsed)}${selected.exit_code !== null ? ` · exit ${selected.exit_code}` : ''}` : 'Idle'}</span>
      <button type="button" className="button danger-button" onClick={stopSelected} disabled={!selected || selected.status !== 'running' || busy}>Stop process</button>
      <button type="button" className="button quiet-button" onClick={clearOutput} disabled={!selected}>Clear output</button>
    </div>
    <div className="terminal-output" key={`${selected?.id || 'empty'}:${clearCount}`} role="region" aria-label="Terminal output" tabIndex="0">
      {currentOutput.stdout && <section><h3>stdout</h3><pre>{currentOutput.stdout}</pre></section>}
      {currentOutput.stderr && <section><h3>stderr</h3><pre>{currentOutput.stderr}</pre></section>}
      {currentOutput.system && <section><h3>BUILDX</h3><pre>{currentOutput.system}</pre></section>}
      {!currentOutput.stdout && !currentOutput.stderr && !currentOutput.system && <p>Command output will appear here after you approve and run a command.</p>}
    </div>
  </section>;
}
