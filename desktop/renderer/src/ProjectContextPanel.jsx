import React, { useEffect, useState } from 'react';

const REASON_LABELS = {
  gitignore: 'ignored by .gitignore',
  generated_directory: 'generated or dependency folders',
  sensitive_file: 'sensitive filenames',
  sensitive_content: 'files containing likely credentials',
  symlink: 'symbolic links',
  binary_file: 'binary files',
  invalid_text: 'invalid UTF-8 text',
  file_too_large: 'files over 1 MiB',
  project_size_limit: 'the 25 MiB project limit',
  file_limit: 'the 5,000-file limit',
  entry_limit: 'the 20,000-entry limit',
};

function displayState(status) {
  if (!status) return 'Loading status';
  return ({
    not_indexed: 'Not indexed',
    indexing: 'Indexing',
    up_to_date: 'Up to date',
    partial: 'Partially indexed',
    failed: 'Index failed',
  })[status.state] || 'Index status unavailable';
}

export default function ProjectContextPanel({ project, onOpenResult }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  async function loadStatus(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const value = await window.buildxDesktop.getProjectIndexStatus(project.id);
      setStatus(value);
      setStatusError('');
    } catch (error) {
      setStatusError(error.message || 'The project index status could not be loaded.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    window.buildxDesktop.getProjectIndexStatus(project.id).then((value) => {
      if (mounted) { setStatus(value); setStatusError(''); }
    }).catch((error) => {
      if (mounted) setStatusError(error.message || 'The project index status could not be loaded.');
    }).finally(() => { if (mounted) setLoading(false); });
    const timer = window.setInterval(() => {
      if (mounted) loadStatus(true);
    }, status?.state === 'indexing' ? 1200 : 8000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [project.id, status?.state]);

  async function refreshIndex() {
    if (refreshing || status?.state === 'indexing') return;
    setRefreshing(true);
    setStatusError('');
    try {
      await window.buildxDesktop.refreshProjectIndex(project.id);
      await loadStatus(true);
    } catch (error) {
      setStatusError(error.message || 'BUILDX could not refresh this project index.');
    } finally {
      setRefreshing(false);
    }
  }

  async function search(event) {
    event.preventDefault();
    if (searching || query.trim().length < 2) return;
    setSearching(true);
    setSearchError('');
    try {
      const response = await window.buildxDesktop.searchProjectContext(project.id, query.trim(), 8);
      setResults(response.results);
    } catch (error) {
      setResults(null);
      setSearchError(error.message || 'The context search could not be completed.');
    } finally {
      setSearching(false);
    }
  }

  const reasons = Object.entries(status?.skip_reasons || {})
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${REASON_LABELS[reason] || reason.replaceAll('_', ' ')}`);

  return <section className="context-panel" aria-labelledby="context-panel-title">
    <div className="context-panel-heading">
      <div><span className="eyebrow">LOCAL PROJECT CONTEXT</span><h2 id="context-panel-title">Index and search project files</h2>
        <p>Indexing stays on this device. Project file contents are not sent to an AI provider.</p></div>
      <button type="button" className="button primary-button" onClick={refreshIndex}
        disabled={refreshing || loading || status?.state === 'indexing'}>
        {status?.state === 'indexing' || refreshing ? 'Indexing…' : status?.state === 'not_indexed' ? 'Build index' : 'Refresh index'}
      </button>
    </div>
    <div className="context-status" role="status" aria-live="polite">
      <strong>{displayState(status)}</strong>
      {status && <span>{status.indexed_file_count} indexed files · {status.chunk_count} searchable chunks · {status.skipped_count} skipped entries</span>}
      {status?.state === 'indexing' && <span>Discovered {status.discovered_count}; processed {status.processed_count}.</span>}
    </div>
    {statusError && <p className="context-error" role="alert">{statusError} <button type="button" className="context-inline-button" onClick={() => loadStatus()}>Retry</button></p>}
    {reasons.length > 0 && <p className="context-note">Skipped: {reasons.join(' · ')}.</p>}
    {status?.errors?.length > 0 && <ul className="context-error-list" aria-label="Indexing issues">{status.errors.slice(0, 5).map((item, index) => <li key={`${item.path}-${index}`}>
      {item.path && <code>{item.path}: </code>}{item.message}
    </li>)}</ul>}
    <form className="context-search-form" onSubmit={search}>
      <label htmlFor="project-context-query">Search indexed context</label>
      <div><input id="project-context-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
        placeholder="Search words in your project…" minLength={2} maxLength={300} />
        <button className="button quiet-button" type="submit" disabled={searching || query.trim().length < 2 || !status?.indexed_file_count}>
          {searching ? 'Searching…' : 'Search'}
        </button></div>
    </form>
    {searchError && <p className="context-error" role="alert">{searchError}</p>}
    {results && (results.length ? <ul className="context-results" aria-label="Project context search results">{results.map((result) => <li key={`${result.relative_path}-${result.start_line}-${result.chunk_hash}`}>
      <button type="button" className="context-result" onClick={() => onOpenResult(result.relative_path, result.start_line)}>
        <span><code>{result.relative_path}</code><small>Lines {result.start_line}–{result.end_line}</small></span>
        <pre>{result.excerpt}</pre>
      </button>
    </li>)}</ul> : <p className="context-empty">No matching context found. Try different words or refresh the index.</p>)}
    {!results && status?.state === 'not_indexed' && <p className="context-empty">Build the local index to search this project.</p>}
  </section>;
}
