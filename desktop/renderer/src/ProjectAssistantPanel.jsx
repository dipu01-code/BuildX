import React, { useEffect, useRef, useState } from 'react';

function timeLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
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
  const sendingRef = useRef(false);
  const composerRef = useRef(null);

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
