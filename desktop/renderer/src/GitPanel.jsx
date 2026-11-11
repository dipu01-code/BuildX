import React, { useCallback, useEffect, useRef, useState } from 'react';

const CODE_LABELS = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', '?': 'Untracked' };

function stagedPaths(status) {
  return (status?.files || []).filter((file) => file.staged).flatMap((file) => [file.path, file.orig_path].filter(Boolean)).sort();
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fileLabel(file, staged) {
  if (file.conflicted) return 'Conflict';
  return CODE_LABELS[staged ? file.index : file.worktree] || 'Changed';
}

export default function GitPanel({ project }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null);
  const [diff, setDiff] = useState('');
  const [message, setMessage] = useState('');
  const [review, setReview] = useState(null);
  const diffRequest = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setStatus(await window.buildxDesktop.getGitStatus(project.id)); }
    catch (loadError) { setError(loadError.message || 'Git status could not be loaded.'); }
    finally { setLoading(false); }
  }, [project.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const files = status?.files || [];
  const staged = files.filter((file) => file.staged);
  const unstaged = files.filter((file) => file.unstaged);
  const currentStaged = stagedPaths(status);
  const isReviewed = Boolean(review && review.message === message && sameList(review.paths, currentStaged));

  async function showDiff(file, fromIndex) {
    // Only the latest click may fill the diff; an older, slower response is dropped.
    const request = ++diffRequest.current;
    setSelected({ path: file.path, staged: fromIndex });
    setDiff('');
    if (file.untracked) return;
    try {
      const result = await window.buildxDesktop.getGitDiff(project.id, file.path, fromIndex);
      if (request === diffRequest.current) setDiff(result.diff);
    } catch (diffError) {
      if (request === diffRequest.current) setError(diffError.message || 'The diff could not be loaded.');
    }
  }

  async function change(action, paths) {
    setBusy(true); setError(''); setNotice('');
    try {
      setStatus(await window.buildxDesktop[action](project.id, paths));
      setSelected(null); setDiff('');
    } catch (changeError) { setError(changeError.message || 'Git could not update the staged files.'); }
    finally { setBusy(false); }
  }

  async function commit() {
    if (!isReviewed || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await window.buildxDesktop.commitGit(project.id, { message: review.message, staged_paths: review.paths });
      setStatus(result.status); setMessage(''); setReview(null); setSelected(null); setDiff('');
      setNotice(`Committed ${result.commit.slice(0, 7)}.`);
    } catch (commitError) { setError(commitError.message || 'The commit could not be created.'); }
    finally { setBusy(false); }
  }

  function fileRow(file, fromIndex) {
    const isSelected = selected?.path === file.path && selected?.staged === fromIndex;
    const paths = fromIndex ? [file.path, file.orig_path].filter(Boolean) : [file.path];
    return <li key={`${fromIndex ? 'staged' : 'unstaged'}:${file.path}`} className={`git-file ${isSelected ? 'active' : ''}`}>
      <button type="button" className="git-file-name" aria-pressed={isSelected} onClick={() => showDiff(file, fromIndex)} title={file.path}>
        <span className="git-file-code">{fileLabel(file, fromIndex)}</span>
        {file.orig_path ? `${file.orig_path} → ${file.path}` : file.path}{file.directory ? '/' : ''}
      </button>
      <button type="button" className="button quiet-button" disabled={busy}
        onClick={() => change(fromIndex ? 'unstageGitPaths' : 'stageGitPaths', paths)}
        aria-label={`${fromIndex ? 'Unstage' : 'Stage'} ${file.path}`}>{fromIndex ? 'Unstage' : 'Stage'}</button>
    </li>;
  }

  const branchText = !status?.repository ? '' : status.detached ? 'Detached HEAD'
    : `${status.branch}${status.initial ? ' (no commits yet)' : ''}${status.upstream ? ` · ${status.ahead} ahead, ${status.behind} behind ${status.upstream}` : ''}`;

  return <section className="terminal-panel" aria-label="Source control">
    <header className="terminal-heading"><div><span className="eyebrow">SOURCE CONTROL</span><h2>Git changes</h2>
      <p>{status?.repository ? <>Branch: <code>{branchText}</code></> : 'Review, stage, and commit changes in this project.'}</p></div>
      <button type="button" className="button quiet-button" onClick={refresh} disabled={loading || busy}>Refresh</button></header>
    {error && <div role="alert" className="terminal-error">{error}</div>}
    {notice && <p role="status">{notice}</p>}
    {loading && !status && <p>Loading Git status…</p>}
    {status && !status.repository && <p>This project folder is not a Git repository. Run <code>git init</code> from the Terminal tab to start one.</p>}
    {status?.repository && <>
      <div className="git-columns">
        <section aria-label="Staged changes"><h3>Staged changes ({staged.length})</h3>
          {staged.length ? <ul className="git-file-list">{staged.map((file) => fileRow(file, true))}</ul> : <p>No staged changes.</p>}</section>
        <section aria-label="Unstaged changes"><h3>Changes ({unstaged.length})</h3>
          {unstaged.length ? <ul className="git-file-list">{unstaged.map((file) => fileRow(file, false))}</ul> : <p>Working tree clean.</p>}</section>
      </div>
      <div className="terminal-output" role="region" aria-label="Diff" tabIndex="0">
        {!selected ? <p>Select a file to see its diff.</p>
          : files.find((file) => file.path === selected.path)?.untracked ? <p>Untracked {selected.path}. Stage it to see its contents as a diff.</p>
            : <pre>{diff || 'No differences.'}</pre>}
      </div>
      <form className="terminal-command-form" onSubmit={(event) => { event.preventDefault(); setReview({ message, paths: currentStaged }); setNotice(''); }}>
        <label htmlFor="git-commit-message">Commit message</label>
        <textarea id="git-commit-message" rows={3} maxLength={5000} value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy} />
        <div className="terminal-command-actions"><span>BUILDX commits locally without running Git hooks. It does not push.</span>
          <button className="button quiet-button" type="submit" disabled={!message.trim() || !staged.length || busy}>Review commit</button></div>
      </form>
      {review && <section className="terminal-review" aria-label="Commit review">
        <h3>Review before committing</h3>
        <dl><dt>Message</dt><dd><pre>{review.message}</pre></dd><dt>Files</dt><dd><ul>{review.paths.map((value) => <li key={value}><code>{value}</code></li>)}</ul></dd></dl>
        {!isReviewed ? <p role="alert">The message or staged files changed. Review the commit again.</p>
          : <button type="button" className="button primary-button" onClick={commit} disabled={busy}>Commit {review.paths.length} {review.paths.length === 1 ? 'path' : 'paths'}</button>}
        <button type="button" className="button quiet-button" onClick={() => setReview(null)} disabled={busy}>Cancel review</button>
      </section>}
    </>}
  </section>;
}
