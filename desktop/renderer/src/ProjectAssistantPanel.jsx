import React, { useEffect, useRef, useState } from 'react';

function timeLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function proposalDiff(original, proposed) {
  const before = (original ?? '').split('\n');
  const after = (proposed ?? '').split('\n');
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const rows = [
    ...before.slice(0, prefix).map((text, index) => ({ kind: 'context', line: index + 1, text })),
    ...before.slice(prefix, before.length - suffix).map((text, index) => ({ kind: 'removed', line: prefix + index + 1, text })),
    ...after.slice(prefix, after.length - suffix).map((text, index) => ({ kind: 'added', line: prefix + index + 1, text })),
    ...before.slice(before.length - suffix).map((text, index) => ({ kind: 'context', line: before.length - suffix + index + 1, text })),
  ];
  return rows.length <= 3000 ? rows : null;
}

export default function ProjectAssistantPanel({ project, onOpenSource }) {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState('');
  const [proposalPath, setProposalPath] = useState('');
  const [proposalRequest, setProposalRequest] = useState('');
  const [proposalCreate, setProposalCreate] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [proposalBusy, setProposalBusy] = useState(false);
  const sendingRef = useRef(false);
  const composerRef = useRef(null);
  const proposalRows = proposal?.operation.operation === 'modify'
    ? proposalDiff(proposal.original_content, proposal.operation.proposed_content) : null;

  function selectProposal(record) {
    setProposal(record);
    if (record) setProposals((current) => [record, ...current.filter((item) => item.id !== record.id)]);
  }

  async function loadConversations(preferredId = activeId) {
    const rows = await window.buildxDesktop.listConversations(project.id);
    setConversations(rows);
    const nextId = preferredId && rows.some((item) => item.id === preferredId) ? preferredId : rows[0]?.id || null;
    setActiveId(nextId);
    if (nextId) {
      const detail = await window.buildxDesktop.getConversation(project.id, nextId);
      setMessages(detail.messages);
    } else setMessages([]);
    return rows;
  }

  useEffect(() => {
    let mounted = true;
    window.buildxDesktop.listChangeProposals(project.id).then((rows) => {
      if (mounted) { setProposals(rows); setProposal(rows[0] || null); }
    }).catch((loadError) => { if (mounted) setError(loadError.message || 'Saved proposals could not be loaded.'); });
    window.buildxDesktop.listConversations(project.id).then(async (rows) => {
      if (!mounted) return;
      setConversations(rows);
      const firstId = rows[0]?.id || null;
      setActiveId(firstId);
      if (firstId) {
        const detail = await window.buildxDesktop.getConversation(project.id, firstId);
        if (mounted) setMessages(detail.messages);
      }
    }).catch((loadError) => { if (mounted) setError(loadError.message || 'The conversation history could not be loaded.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [project.id]);

  async function selectConversation(id) {
    if (sendingRef.current) return;
    setLoading(true);
    setError('');
    try {
      const detail = await window.buildxDesktop.getConversation(project.id, id);
      setActiveId(id);
      setMessages(detail.messages);
    } catch (loadError) {
      setError(loadError.message || 'The conversation could not be opened.');
    } finally { setLoading(false); }
  }

  async function startConversation() {
    if (sendingRef.current) return;
    setLoading(true);
    setError('');
    try {
      const conversation = await window.buildxDesktop.createConversation(project.id);
      await loadConversations(conversation.id);
      composerRef.current?.focus();
    } catch (createError) {
      setError(createError.message || 'A new conversation could not be created.');
    } finally { setLoading(false); }
  }

  async function deleteActive() {
    if (!activeId || sendingRef.current) return;
    try {
      await window.buildxDesktop.deleteConversation(project.id, activeId);
      setActiveId(null);
      setMessages([]);
      await loadConversations(null);
    } catch (deleteError) { setError(deleteError.message || 'The conversation could not be deleted.'); }
  }

  async function submitMessage(event, retry = null) {
    event?.preventDefault?.();
    const content = retry?.content || draft.trim();
    if (sendingRef.current || !content || content.length > 8000) return;
    sendingRef.current = true;
    setSending(true);
    setError('');
    let conversationId = activeId;
    try {
      if (!conversationId) {
        const conversation = await window.buildxDesktop.createConversation(project.id);
        conversationId = conversation.id;
        setActiveId(conversationId);
      }
      const requestId = retry?.requestId || crypto.randomUUID();
      setDraft('');
      const result = await window.buildxDesktop.sendConversationMessage(project.id, conversationId, requestId, content);
      setActiveId(conversationId);
      const detail = await window.buildxDesktop.getConversation(project.id, conversationId);
      setMessages(detail.messages);
      await loadConversations(conversationId);
      if (result.assistant_message.status === 'complete') composerRef.current?.focus();
    } catch (sendError) {
      setError(sendError.message || 'The assistant could not answer. Retry when ready.');
      if (conversationId) {
        try {
          const detail = await window.buildxDesktop.getConversation(project.id, conversationId);
          setMessages(detail.messages);
          setActiveId(conversationId);
          await loadConversations(conversationId);
        } catch { /* Keep the safe send error visible when reloading also fails. */ }
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function copyAnswer(message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopyState(message.id);
      window.setTimeout(() => setCopyState(''), 1500);
    } catch { setError('BUILDX could not copy the answer to the clipboard.'); }
  }

  async function createProposal(event) {
    event.preventDefault();
    if (!proposalPath.trim() || !proposalRequest.trim() || proposalBusy) return;
    setProposalBusy(true); setError('');
    try {
      let originalContent = null; let originalHash = null;
      if (!proposalCreate) {
        const file = await window.buildxDesktop.readWorkspaceText(project.id, proposalPath.trim());
        originalContent = file.content;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(originalContent));
        originalHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      }
      const result = await window.buildxDesktop.generateChangeProposal(project.id, {
        request: proposalRequest.trim(), relative_path: proposalPath.trim(), original_content: originalContent,
        original_hash: originalHash, conversation_id: activeId,
      });
      selectProposal(result); setProposalRequest('');
    } catch (proposalError) { setError(proposalError.message || 'Could not generate a proposal.'); }
    finally { setProposalBusy(false); }
  }

  async function rejectProposal() {
    if (!proposal || proposal.status !== 'pending_review') return;
    setProposalBusy(true);
    try { selectProposal(await window.buildxDesktop.rejectChangeProposal(project.id, proposal.id)); }
    catch (proposalError) { setError(proposalError.message || 'Could not reject the proposal.'); }
    finally { setProposalBusy(false); }
  }

  async function applyApprovedProposal(proposalId) {
    const allowed = await new Promise((resolve) => {
      window.dispatchEvent(new CustomEvent('buildx:proposal-before-apply', { detail: { projectId: project.id, path: proposal.operation.relative_path, resolve } }));
      window.setTimeout(() => resolve(false), 100);
    });
    if (!allowed) throw new Error('Close or save the affected editor tab before applying this change.');
    const applied = await window.buildxDesktop.applyApprovedChangeProposal(project.id, proposalId);
    selectProposal(applied);
    window.dispatchEvent(new CustomEvent('buildx:proposal-applied', { detail: { projectId: project.id, path: applied.operation.relative_path } }));
  }

  async function approveAndApply() {
    if (!proposal || proposal.status !== 'pending_review' || proposalBusy) return;
    const approved = window.confirm(`Approve and apply this exact change to ${proposal.operation.relative_path}? Review the complete before and after contents above first.`);
    if (!approved) return;
    setProposalBusy(true); setError('');
    try {
      const result = await window.buildxDesktop.approveChangeProposal(project.id, proposal.id);
      selectProposal(result);
      await applyApprovedProposal(proposal.id);
    } catch (applyError) {
      try { selectProposal(await window.buildxDesktop.getChangeProposal(project.id, proposal.id)); } catch { /* Keep the review visible. */ }
      setError(applyError.message || 'The approved proposal could not be applied.');
    } finally { setProposalBusy(false); }
  }

  function onComposerKeyDown(event) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitMessage();
    }
  }

  return <section className="assistant-panel" aria-labelledby="assistant-title">
    <aside className="assistant-history" aria-label="Recent conversations">
      <div className="assistant-history-heading"><span className="eyebrow">PROJECT CHAT</span><button type="button" className="button quiet-button" onClick={startConversation} disabled={loading || sending}>New chat</button></div>
      {loading && <p className="assistant-muted" role="status">Loading conversations…</p>}
      {!loading && !conversations.length && <p className="assistant-muted">No conversations yet.</p>}
      <ul>{conversations.map((conversation) => <li key={conversation.id}>
        <button type="button" className={`assistant-history-item ${conversation.id === activeId ? 'active' : ''}`} onClick={() => selectConversation(conversation.id)} disabled={sending}>
          <strong>{conversation.title}</strong><small>{conversation.message_count} messages · {timeLabel(conversation.updated_at)}</small>
        </button>
      </li>)}</ul>
    </aside>
    <div className="assistant-chat">
      <div className="assistant-heading">
        <div><span className="eyebrow">AI CODING ASSISTANT</span><h2 id="assistant-title">Ask about {project.name}</h2>
          <p>Answers can use the excerpts shown below each response. No files are changed and no commands are run.</p></div>
        {activeId && <button type="button" className="context-inline-button" onClick={deleteActive} disabled={sending}>Delete chat</button>}
      </div>
      {error && <div className="assistant-error" role="alert"><span>{error}</span><button type="button" className="context-inline-button" onClick={() => loadConversations().catch((loadError) => setError(loadError.message))}>Retry loading</button></div>}
      <div className="assistant-transcript" role="log" aria-live="polite" aria-label="Conversation messages">
        {!messages.length && !loading && <div className="assistant-empty"><strong>Start with a question about your code</strong><p>For project-specific answers, build the local index in the Context tab first.</p></div>}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const retryContent = message.role === 'assistant' && message.status !== 'complete' && previous?.role === 'user' ? previous.content : '';
          return <article className={`assistant-message ${message.role}`} key={message.id}>
            <div className="assistant-message-meta"><strong>{message.role === 'user' ? 'You' : 'BUILDX Assistant'}</strong><time>{timeLabel(message.created_at)}</time></div>
            {message.status === 'pending' ? <p className="assistant-progress" role="status">Thinking…</p>
              : message.content ? <pre className="assistant-message-content">{message.content}</pre> : null}
            {message.role === 'assistant' && message.status === 'complete' && <>
              <p className="assistant-context-label">{message.sources.length ? 'Project context supplied to the answer' : 'General answer · no indexed excerpts matched'}</p>
              {message.sources.length > 0 && <ul className="assistant-sources" aria-label="Source excerpts supplied to assistant">{message.sources.map((source) => <li key={`${source.relative_path}:${source.start_line}:${source.end_line}`}>
                <button type="button" onClick={() => onOpenSource(source.relative_path, source.start_line)}><code>{source.relative_path}</code><span>Lines {source.start_line}–{source.end_line}</span></button>
              </li>)}</ul>}
              <button type="button" className="context-inline-button" onClick={() => copyAnswer(message)}>{copyState === message.id ? 'Copied' : 'Copy answer'}</button>
            </>}
            {message.role === 'assistant' && message.status !== 'complete' && <div className="assistant-failure">
              <p>{message.error_message || (message.status === 'interrupted' ? 'Generation was interrupted.' : 'The response did not complete.')}</p>
              {retryContent && message.request_id && <button type="button" className="button quiet-button" onClick={() => submitMessage(null, { content: retryContent, requestId: message.request_id })} disabled={sending}>Retry response</button>}
            </div>}
          </article>;
        })}
        {sending && <p className="assistant-progress" role="status">Preparing a bounded context response…</p>}
      </div>
      <section className="proposal-review" aria-label="Code change proposals">
        <h3>Propose a code change</h3>
        <p>The selected file and up to three matching indexed excerpts are sent to your configured AI provider to prepare one proposal. The file stays unchanged until you review and explicitly approve application.</p>
        <form onSubmit={createProposal} className="proposal-form">
          <label htmlFor="proposal-path">Project-relative file path</label>
          <input id="proposal-path" value={proposalPath} onChange={(event) => setProposalPath(event.target.value)} maxLength={2048} placeholder="src/example.py" disabled={proposalBusy} />
          <label htmlFor="proposal-request">Requested change</label>
          <textarea id="proposal-request" value={proposalRequest} onChange={(event) => setProposalRequest(event.target.value)} maxLength={4000} rows={3} disabled={proposalBusy} />
          <label><input type="checkbox" checked={proposalCreate} onChange={(event) => setProposalCreate(event.target.checked)} disabled={proposalBusy} /> Create a new file (destination must not exist)</label>
          <button className="button primary-button" type="submit" disabled={proposalBusy || !proposalPath.trim() || !proposalRequest.trim()}>{proposalBusy ? 'Preparing…' : 'Generate proposal'}</button>
        </form>
        {proposals.length > 0 && <div className="proposal-history"><label htmlFor="proposal-history">Saved proposals</label><select id="proposal-history" value={proposal?.id || ''} onChange={(event) => {
          const selected = proposals.find((item) => item.id === event.target.value);
          if (selected) window.buildxDesktop.getChangeProposal(project.id, selected.id).then(selectProposal).catch((loadError) => setError(loadError.message));
        }}>{proposals.map((item) => <option key={item.id} value={item.id}>{item.summary} · {item.status.replaceAll('_', ' ')}</option>)}</select></div>}
        {proposal && <article className="proposal-card" aria-live="polite">
          <div><strong>{proposal.summary}</strong><span className="proposal-status">{proposal.status.replaceAll('_', ' ')}</span></div>
          <p>{proposal.operation.operation === 'create' ? 'New file' : 'Modify file'}: <code>{proposal.operation.relative_path}</code></p>
          {proposal.operation.operation === 'modify' && <><h4>Line review: “−” removed, “+” added, “ ” unchanged</h4>
            {proposalRows
              ? <pre className="proposal-content proposal-diff" tabIndex="0" aria-label="Line-by-line proposed diff">{proposalRows.map((row, index) => <span className={`proposal-diff-${row.kind}`} key={`${row.kind}-${row.line}-${index}`}>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '} {String(row.line).padStart(4, ' ')} │ {row.text}{index < proposalRows.length - 1 ? '\n' : ''}</span>)}</pre>
              : <><pre className="proposal-content" tabIndex="0" aria-label="Original file content">Original content:\n{proposal.original_content ?? ''}</pre><pre className="proposal-content" tabIndex="0" aria-label="Proposed file content">Proposed content:\n{proposal.operation.proposed_content}</pre></>}
          </>}
          {proposal.operation.operation === 'create' && <><h4>New file contents</h4><pre className="proposal-content" tabIndex="0" aria-label="New file content">{proposal.operation.proposed_content}</pre></>}
          {proposal.status === 'pending_review' && <div className="proposal-actions"><button className="button quiet-button" type="button" onClick={rejectProposal} disabled={proposalBusy}>Reject proposal</button><button className="button primary-button" type="button" onClick={approveAndApply} disabled={proposalBusy}>Review and approve</button></div>}
          {proposal.status === 'approved' && <div className="proposal-actions"><button className="button primary-button" type="button" onClick={async () => { setProposalBusy(true); try { await applyApprovedProposal(proposal.id); } catch (applyError) { setError(applyError.message); try { selectProposal(await window.buildxDesktop.getChangeProposal(project.id, proposal.id)); } catch { /* Keep state visible. */ } } finally { setProposalBusy(false); } }} disabled={proposalBusy}>Apply approved change</button></div>}
          {proposal.status === 'applied' && <p role="status">Application confirmed by BUILDX. Refresh the workspace to inspect the resulting file.</p>}
          {['conflicted', 'failed'].includes(proposal.status) && <p role="alert">Application {proposal.status}. Generate and review a fresh proposal if the file changed.</p>}
        </article>}
      </section>
      <form className="assistant-composer" onSubmit={submitMessage}>
        <label htmlFor="assistant-message">Your question</label>
        <textarea id="assistant-message" ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown}
          rows={4} maxLength={8000} placeholder="Ask about the selected project…" disabled={sending} />
        <div className="assistant-composer-footer"><p>When sent, your question and up to five matching indexed excerpts are sent to the configured OpenAI provider. Conversations stay in local SQLite.</p>
          <button type="submit" className="button primary-button" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send message'}</button></div>
      </form>
    </div>
  </section>;
}
