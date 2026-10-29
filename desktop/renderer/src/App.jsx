import React, { Component, lazy, useEffect, useRef, useState } from 'react';
import { languageNameForPath } from './editor-language-name.js';
import AISettings from './AISettings.jsx';
import ProjectPlanner from './ProjectPlanner.jsx';
import ProjectContextPanel from './ProjectContextPanel.jsx';
import ProjectAssistantPanel from './ProjectAssistantPanel.jsx';
import TerminalPanel from './TerminalPanel.jsx';
import TestingPanel from './TestingPanel.jsx';

const CodeEditor = lazy(() => import('./CodeEditor.jsx'));

const sections = [
  { id: 'home', label: 'Overview', icon: '⌂' },
  { id: 'projects', label: 'Projects', icon: '▤' },
  { id: 'planner', label: 'Planner', icon: '✳' },
  { id: 'tasks', label: 'Tasks', icon: '☷' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

/** @param {{ children: import('react').ReactNode, onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void, className?: string, title?: string, type?: 'button' | 'submit' | 'reset', disabled?: boolean }} props */
function Button({ children, onClick, className = '', title, type = 'button', disabled = false }) {
  return <button type={type} className={`button ${className}`} onClick={onClick} title={title} disabled={disabled}>{children}</button>;
}

/** @param {{ label: string, children: import('react').ReactNode, onClick: () => void }} props */
function IconButton({ label, children, onClick }) {
  return <button type="button" className="icon-button" aria-label={label} onClick={onClick}>{children}</button>;
}

/** @param {{ value: string, onChange: (value: string) => void, label: string }} props */
function TextInput({ id, value, onChange, label, placeholder = '', maxLength }) {
  return <input id={id} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={maxLength} />;
}

/** @param {{ tabs: string[], activeTab: string, onSelect: (tab: string) => void }} props */
function Tabs({ tabs, activeTab, onSelect, label = 'Workspace views' }) {
  return <div className="tab-list" role="tablist" aria-label={label}>
    {tabs.map((tab, index) => <button type="button" key={tab} role="tab" tabIndex={activeTab === tab ? 0 : -1} aria-selected={activeTab === tab} className={`tab ${activeTab === tab ? 'active' : ''}`} onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      onSelect(tabs[nextIndex]);
      event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
    }} onClick={() => onSelect(tab)}>{tab}</button>)}
  </div>;
}

/** @param {{ message: string, onDismiss: () => void }} props */
function Toast({ message, onDismiss }) {
  return <div className="toast" role="status"><span className="toast-check" aria-hidden="true">✓</span>{message}<IconButton label="Dismiss notification" onClick={onDismiss}>×</IconButton></div>;
}

function ProjectManagementView({
  projects, selectedProject, loading, error, onRetry, onCreate, onSelect, onEdit, onDelete, onChooseDirectory, onOpenWorkspace, onPlanProject,
}) {
  return <section className="workspace-list-view" aria-labelledby="projects-title">
    <div className="workspace-list-heading">
      <div><span className="eyebrow">PROJECT MANAGEMENT</span><h1 id="projects-title">{selectedProject ? selectedProject.name : 'Projects'}</h1>
        <p>{selectedProject ? 'Project metadata and local directory association.' : 'Your projects are stored in the local BUILDX database.'}</p></div>
      <div className="project-heading-actions">
        {selectedProject && <Button className="quiet-button" onClick={() => onSelect(null)}>All projects</Button>}
        <Button className="primary-button" onClick={onCreate}><span aria-hidden="true">＋</span> New project</Button>
      </div>
    </div>
    {loading && <p className="project-state" role="status">Loading projects…</p>}
    {error && <div className="project-error" role="alert"><span>{error}</span><Button className="quiet-button" onClick={onRetry}>Retry</Button></div>}
    {selectedProject && <article className="project-detail-card">
      <div className="project-detail-top"><span className="project-card-mark" aria-hidden="true">{selectedProject.name.slice(0, 1).toUpperCase()}</span><span className="project-card-meta"><strong>{selectedProject.project_type || 'Uncategorized project'}</strong><small>Updated {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(selectedProject.updated_at))}</small></span></div>
      <dl className="project-detail-list"><dt>Description</dt><dd>{selectedProject.description || 'No description added.'}</dd><dt>Project directory</dt><dd>{selectedProject.root_path || 'Not set. Choose a folder to browse project files.'}</dd></dl>
      <div className="project-detail-actions"><Button className="primary-button" onClick={() => selectedProject.root_path ? onOpenWorkspace(selectedProject) : onChooseDirectory(selectedProject)}>{selectedProject.root_path ? 'Open workspace' : 'Choose project folder'} <span aria-hidden="true">↗</span></Button><Button className="quiet-button" onClick={() => onPlanProject(selectedProject)}>Plan project</Button>{selectedProject.root_path && <Button className="quiet-button" onClick={() => onChooseDirectory(selectedProject)}>Change folder</Button>}<Button className="quiet-button" onClick={() => onEdit(selectedProject)}>Edit details</Button><Button className="danger-button" onClick={() => onDelete(selectedProject)}>Delete project</Button></div>
      <p className="project-delete-note">Deleting a project removes only its BUILDX record; local files are left untouched.</p>
    </article>}
    {!selectedProject && !loading && !projects.length && !error && <div className="workspace-list-empty"><div className="empty-icon">▤</div><h2>No projects yet</h2><p>Create a project record to keep its description and directory association in BUILDX.</p><Button className="primary-button" onClick={onCreate}>Create a project <span aria-hidden="true">↗</span></Button></div>}
    {!selectedProject && projects.length > 0 && <ul className="project-cards">{projects.map((project) => <li className="project-card" key={project.id}>
      <button className="project-card-open" type="button" onClick={() => onSelect(project.id)}><span className="project-card-mark" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span><span className="project-card-copy"><strong>{project.name}</strong><small>{project.description || project.project_type || 'No additional details'}</small></span><span className="project-card-date">Updated {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(project.updated_at))}</span></button>
      <div className="project-card-actions"><IconButton label={`Edit ${project.name}`} onClick={() => onEdit(project)}>✎</IconButton><IconButton label={`Delete ${project.name}`} onClick={() => onDelete(project)}>×</IconButton></div>
    </li>)}</ul>}
  </section>;
}

function WorkspaceExplorer({ project, onBack, onChangeFolder, onNavigateSection }) {
  const [entriesByPath, setEntriesByPath] = useState({});
  const [expanded, setExpanded] = useState(new Set(['']));
  const [selected, setSelected] = useState(null);
  const [files, setFiles] = useState([]);
  const [activeFilePath, setActiveFilePath] = useState(null);
  const [editorError, setEditorError] = useState('');
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [closeTarget, setCloseTarget] = useState(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [copyTarget, setCopyTarget] = useState(null);
  const [copyPath, setCopyPath] = useState('');
  const editorControlsRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [dialogValue, setDialogValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [workspaceView, setWorkspaceView] = useState('Files');
  const [requestedEditorLine, setRequestedEditorLine] = useState(1);
  const needsFolderConfirmation = /confirm this project folder|folder changed\. choose it again|choose it again to confirm/i.test(error);

  async function loadDirectory(relativePath = '', { initial = false } = {}) {
    if (initial) setLoading(true);
    setError('');
    try {
      const result = await window.buildxDesktop.listWorkspaceDirectory(project.id, relativePath);
      setEntriesByPath((current) => ({ ...current, [relativePath]: result.entries }));
    } catch (loadError) {
      setError(loadError.message || 'Could not load this folder.');
    } finally {
      if (initial) setLoading(false);
    }
  }

  async function confirmProjectFolder() {
    const result = await onChangeFolder();
    if (result && !result.canceled) await loadDirectory('', { initial: true });
  }

  useEffect(() => {
    setEntriesByPath({});
    setExpanded(new Set(['']));
    setSelected(null);
    setFiles([]);
    setActiveFilePath(null);
    setEditorError('');
    loadDirectory('', { initial: true });
  }, [project.id, project.root_path]);

  function joinPath(parent, name) { return parent ? `${parent}/${name}` : name; }
  async function toggleFolder(entry) {
    const pathName = entry.path;
    if (expanded.has(pathName)) {
      setExpanded((current) => { const next = new Set(current); next.delete(pathName); return next; });
      return;
    }
    setExpanded((current) => new Set(current).add(pathName));
    if (!entriesByPath[pathName]) await loadDirectory(pathName);
  }
  async function selectEntry(entry) {
    setSelected(entry);
    if (entry.type !== 'file') return;
    const open = files.find((file) => file.path === entry.path);
    if (open) { setRequestedEditorLine(1); setActiveFilePath(open.path); setEditorError(''); return; }
    setEditorError('');
    try {
      const result = await window.buildxDesktop.readWorkspaceText(project.id, entry.path);
      const file = { path: entry.path, content: result.content, originalContent: result.content, revision: result.revision };
      setFiles((current) => current.some((item) => item.path === file.path) ? current : [...current, file]);
      setRequestedEditorLine(1);
      setActiveFilePath(file.path);
      setCursor({ line: 1, column: 1 });
    } catch (readError) { setEditorError(readError.message || 'This file could not be opened.'); }
  }
  async function openContextResult(relativePath, line) {
    const existing = files.find((file) => file.path === relativePath);
    if (existing) {
      setActiveFilePath(relativePath);
      setSelected({ name: relativePath.split('/').at(-1), path: relativePath, type: 'file' });
      setWorkspaceView('Files');
      window.setTimeout(() => editorControlsRef.current?.goToLine?.(line), 0);
      return;
    }
    try {
      const result = await window.buildxDesktop.readWorkspaceText(project.id, relativePath);
      const file = { path: relativePath, content: result.content, originalContent: result.content, revision: result.revision };
      setFiles((current) => current.some((item) => item.path === file.path) ? current : [...current, file]);
      setActiveFilePath(file.path);
      setSelected({ name: relativePath.split('/').at(-1), path: relativePath, type: 'file' });
      setRequestedEditorLine(line);
      setWorkspaceView('Files');
    } catch (openError) {
      setEditorError(openError.message || 'The search result could not be opened. Refresh the index and try again.');
      setWorkspaceView('Files');
    }
  }
  const activeFile = files.find((file) => file.path === activeFilePath) || null;
  function isDirty(file) { return Boolean(file && file.content !== file.originalContent); }
  function updateFileContent(filePath, content) {
    setFiles((current) => current.map((file) => file.path === filePath ? { ...file, content } : file));
  }
  async function saveFile(file = activeFile) {
    if (!file || !isDirty(file)) return true;
    setEditorError('');
    try {
      const result = await window.buildxDesktop.writeWorkspaceText(project.id, file.path, file.content, file.revision);
      setFiles((current) => current.map((item) => item.path === file.path
        ? { ...item, originalContent: item.content, revision: result.revision } : item));
      return true;
    } catch (saveError) {
      setEditorError(saveError.message || 'The file could not be saved. Your edits are still available.');
      return false;
    }
  }
  function closeFile(filePath, force = false) {
    const file = files.find((item) => item.path === filePath);
    if (!file) return;
    if (!force && isDirty(file)) { setCloseTarget(file); return; }
    const remaining = files.filter((item) => item.path !== filePath);
    setFiles(remaining);
    if (activeFilePath === filePath) setActiveFilePath(remaining.at(-1)?.path || null);
    setCloseTarget(null);
  }
  async function saveAndClose() {
    if (await saveFile(closeTarget)) closeFile(closeTarget.path, true);
  }
  async function saveAndLeave() {
    for (const file of files) {
      if (isDirty(file) && !(await saveFile(file))) return;
    }
    const target = leaveTarget;
    setLeaveConfirm(false); setLeaveTarget(null);
    if (target?.section) onNavigateSection(target.section);
    else onBack();
  }
  function leaveWorkspace() {
    if (files.some(isDirty)) { setLeaveTarget(null); setLeaveConfirm(true); }
    else onBack();
  }
  function finishLeaving() {
    const target = leaveTarget;
    setFiles([]); setActiveFilePath(null); setLeaveConfirm(false); setLeaveTarget(null);
    if (target?.section) onNavigateSection(target.section);
    else onBack();
  }
  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (!files.some(isDirty)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [files]);
  useEffect(() => {
    const onNavigate = (event) => {
      if (!files.some(isDirty)) return;
      event.preventDefault();
      setLeaveTarget({ section: event.detail.section });
      setLeaveConfirm(true);
    };
    window.addEventListener('buildx:navigate', onNavigate);
    return () => window.removeEventListener('buildx:navigate', onNavigate);
  }, [files]);
  useEffect(() => {
    const checkProposalApply = (event) => {
      if (event.detail?.projectId !== project.id) return;
      const open = files.find((file) => file.path === event.detail.path);
      event.detail.resolve?.(!open || !isDirty(open));
    };
    const refreshAfterProposal = async (event) => {
      if (event.detail?.projectId !== project.id) return;
      const relativePath = event.detail.path;
      const parent = relativePath.split('/').slice(0, -1).join('/');
      await loadDirectory(parent);
      const open = files.find((file) => file.path === relativePath);
      if (open && !isDirty(open)) {
        try {
          const latest = await window.buildxDesktop.readWorkspaceText(project.id, relativePath);
          setFiles((current) => current.map((file) => file.path === relativePath
            ? { ...file, content: latest.content, originalContent: latest.content, revision: latest.revision } : file));
        } catch (refreshError) { setEditorError(refreshError.message || 'The applied file could not be refreshed.'); }
      }
    };
    window.addEventListener('buildx:proposal-before-apply', checkProposalApply);
    window.addEventListener('buildx:proposal-applied', refreshAfterProposal);
    return () => {
      window.removeEventListener('buildx:proposal-before-apply', checkProposalApply);
      window.removeEventListener('buildx:proposal-applied', refreshAfterProposal);
    };
  }, [files, project.id]);
  async function saveCopy(event) {
    event.preventDefault();
    if (!copyTarget || !copyPath.trim() || busy) return;
    const parent = copyTarget.path.split('/').slice(0, -1).join('/');
    const destination = joinPath(parent, copyPath.trim());
    setBusy(true);
    try {
      await window.buildxDesktop.createWorkspaceFile(project.id, destination);
      const empty = await window.buildxDesktop.readWorkspaceText(project.id, destination);
      const saved = await window.buildxDesktop.writeWorkspaceText(project.id, destination, copyTarget.content, empty.revision);
      const copied = { path: destination, content: copyTarget.content, originalContent: copyTarget.content, revision: saved.revision };
      setFiles((current) => [...current, copied]);
      setActiveFilePath(destination);
      setSelected({ name: destination.split('/').at(-1), path: destination, type: 'file' });
      setCopyTarget(null); setCopyPath(''); setEditorError('');
      await loadDirectory(parent);
    } catch (copyError) {
      setEditorError(copyError.message || 'The copy could not be saved. Your original edits are still available.');
    } finally { setBusy(false); }
  }
  function flatten(pathName = '', depth = 0) {
    return (entriesByPath[pathName] || []).flatMap((entry) => [
      { ...entry, depth },
      ...(entry.type === 'directory' && expanded.has(entry.path) ? flatten(entry.path, depth + 1) : []),
    ]);
  }
  async function submitDialog(event) {
    event.preventDefault();
    const name = dialogValue.trim();
    if (!name || busy) return;
    const currentDir = selected?.type === 'directory' ? selected.path : selected ? selected.path.split('/').slice(0, -1).join('/') : '';
    const target = dialog === 'move' ? name : joinPath(currentDir, name);
    setBusy(true); setError('');
    try {
      if (dialog === 'file') await window.buildxDesktop.createWorkspaceFile(project.id, target);
      else if (dialog === 'folder') await window.buildxDesktop.createWorkspaceFolder(project.id, target);
      else await window.buildxDesktop.moveWorkspaceItem(project.id, selected.path, target);
      setDialog(null); setDialogValue('');
      await loadDirectory(currentDir);
      if (dialog === 'move') {
        const destinationParent = target.split('/').slice(0, -1).join('/');
        if (destinationParent !== currentDir) await loadDirectory(destinationParent);
        setFiles((current) => current.map((file) => file.path === selected.path || file.path.startsWith(`${selected.path}/`)
          ? { ...file, path: `${target}${file.path.slice(selected.path.length)}` } : file));
        if (activeFilePath === selected.path || activeFilePath?.startsWith(`${selected.path}/`)) {
          setActiveFilePath(`${target}${activeFilePath.slice(selected.path.length)}`);
        }
        setSelected({ ...selected, path: target, name: target.split('/').at(-1) });
        setSelected(null);
      }
    } catch (operationError) { setError(operationError.message || 'The workspace operation failed.'); }
    finally { setBusy(false); }
  }
  async function deleteSelected() {
    if (!deleteTarget || busy) return;
    const affectsFile = (file) => file.path === deleteTarget.path || (deleteTarget.type === 'directory' && file.path.startsWith(`${deleteTarget.path}/`));
    if (files.some((file) => affectsFile(file) && isDirty(file))) {
      setEditorError('Save or discard the unsaved file edits before deleting this item.');
      setDeleteTarget(null);
      return;
    }
    setBusy(true); setError('');
    try {
      const parent = deleteTarget.path.split('/').slice(0, -1).join('/');
      await window.buildxDesktop.deleteWorkspaceItem(project.id, deleteTarget.path);
      setDeleteTarget(null); setSelected(null);
      setFiles((current) => current.filter((file) => !affectsFile(file)));
      if (activeFilePath && affectsFile({ path: activeFilePath })) setActiveFilePath(null);
      await loadDirectory(parent);
    } catch (deleteError) { setError(deleteError.message || 'The item could not be deleted.'); setDeleteTarget(null); }
    finally { setBusy(false); }
  }
  const rows = flatten();

  return <section className="workspace-explorer" aria-label="Project workspace">
    <div className="workspace-explorer-heading"><div><span className="eyebrow">PROJECT WORKSPACE</span><h1>{project.name}</h1><p className="workspace-root-path">{project.root_path}</p></div><div className="workspace-explorer-actions"><Button className="quiet-button" onClick={() => loadDirectory('', { initial: true })}>Refresh</Button><Button className="quiet-button" onClick={onChangeFolder}>Change folder</Button><Button className="quiet-button" onClick={leaveWorkspace}>Back to project</Button></div></div>
    <div className="workspace-operation-bar"><Button className="primary-button" onClick={() => { setDialog('file'); setDialogValue(''); }}>New file</Button><Button className="quiet-button" onClick={() => { setDialog('folder'); setDialogValue(''); }}>New folder</Button>{selected && selected.type !== 'symlink' && <><Button className="quiet-button" onClick={() => { setDialog('move'); setDialogValue(selected.path); }}>Rename / move</Button><Button className="danger-button" onClick={() => setDeleteTarget(selected)}>Delete</Button></>}</div>
    {error && <div className="project-error" role="alert"><span>{error}</span>{needsFolderConfirmation
      ? <Button className="quiet-button" onClick={confirmProjectFolder}>Confirm project folder</Button>
      : <Button className="quiet-button" onClick={() => loadDirectory('')}>Retry</Button>}</div>}
    <Tabs tabs={['Files', 'Context', 'Assistant', 'Terminal', 'Testing']} activeTab={workspaceView} label="Project workspace views" onSelect={setWorkspaceView} />
    {workspaceView === 'Testing' ? <TestingPanel project={project} onOpenSource={openContextResult} onOpenAssistant={() => setWorkspaceView('Assistant')} />
      : workspaceView === 'Terminal' ? <TerminalPanel project={project} />
      : workspaceView === 'Context' ? <ProjectContextPanel project={project} onOpenResult={openContextResult} />
      : workspaceView === 'Assistant' ? <ProjectAssistantPanel project={project} onOpenSource={openContextResult} />
        : loading ? <p role="status" className="project-state">Loading project files…</p> : <div className="workspace-browser-layout">
      <section className="file-tree-panel" aria-label="Project file tree"><div className="file-tree-heading"><strong>FILES</strong><span>Project root</span></div>{rows.length ? <ul className="file-tree">{rows.map((entry) => <li key={entry.path} style={{ '--tree-depth': entry.depth }}><button type="button" className={`file-tree-row ${selected?.path === entry.path ? 'selected' : ''} ${entry.type === 'symlink' ? 'blocked' : ''}`} onClick={() => entry.type === 'directory' ? toggleFolder(entry) : selectEntry(entry)} aria-label={`${entry.type === 'directory' ? expanded.has(entry.path) ? 'Collapse' : 'Expand' : 'Select'} ${entry.name}`}><span className="tree-disclosure">{entry.type === 'directory' ? expanded.has(entry.path) ? '⌄' : '›' : ' '}</span><span aria-hidden="true">{entry.type === 'directory' ? '▰' : entry.type === 'symlink' ? '↗' : '▤'}</span><span>{entry.name}</span>{entry.type === 'file' && <small>{entry.size} B</small>}</button></li>)}</ul> : <p className="project-state">This folder is empty.</p>}</section>
      <section className="file-preview-panel editor-panel" aria-label="Code editor">
        <div className="editor-tabs" role="tablist" aria-label="Open files">{files.map((file) => <div className={`editor-tab ${activeFilePath === file.path ? 'active' : ''}`} key={file.path}><button type="button" role="tab" aria-selected={activeFilePath === file.path} title={file.path} onClick={() => { setRequestedEditorLine(1); setActiveFilePath(file.path); setSelected({ name: file.path.split('/').at(-1), path: file.path, type: 'file' }); setEditorError(''); }}>{file.path.split('/').at(-1)}{isDirty(file) && <span className="dirty-dot" aria-label="Unsaved changes">●</span>}</button><IconButton label={`Close ${file.path}`} onClick={() => closeFile(file.path)}>×</IconButton></div>)}</div>
        {activeFile ? <><div className="editor-file-toolbar"><span title={activeFile.path}>{activeFile.path}</span><div><Button className="quiet-button" onClick={() => editorControlsRef.current?.find()}>Find</Button><Button className="primary-button" onClick={() => saveFile()} disabled={!isDirty(activeFile)}>{isDirty(activeFile) ? 'Save' : 'Saved'} <kbd>⌘S</kbd></Button></div></div>{editorError && <div className="editor-error" role="alert"><span>{editorError}</span><Button className="quiet-button" onClick={() => { setCopyTarget(activeFile); setCopyPath(`${activeFile.path.split('/').at(-1)}.copy`); }}>Save as copy</Button></div>}<div className="code-editor-wrap"><React.Suspense fallback={<p className="project-state" role="status">Loading editor…</p>}><CodeEditor key={activeFile.path} path={activeFile.path} value={activeFile.content} initialLine={requestedEditorLine} onChange={(content) => updateFileContent(activeFile.path, content)} onSave={() => saveFile(activeFile)} onState={setCursor} onReady={(controls) => { editorControlsRef.current = controls; }} /></React.Suspense></div><div className="editor-statusbar"><span>{languageNameForPath(activeFile.path)}</span><span>Ln {cursor.line}, Col {cursor.column}</span><span>{isDirty(activeFile) ? 'UNSAVED' : 'SAVED'}</span></div></> : <div className="file-preview-empty"><span aria-hidden="true">⌘</span><p>Open a text file to start editing.</p></div>}
      </section>
    </div>}
    {dialog && <div className="modal-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title"><div className="dialog-top"><span className="dialog-kicker">WORKSPACE ITEM</span><IconButton label="Close dialog" onClick={() => setDialog(null)}>×</IconButton></div><h2 id="workspace-dialog-title">{dialog === 'file' ? 'Create a file' : dialog === 'folder' ? 'Create a folder' : 'Rename or move'}</h2><p>{dialog === 'move' ? 'Enter a project-relative destination path. Existing items will not be overwritten.' : 'Enter a name for this new item in the current folder.'}</p><form onSubmit={submitDialog}><label htmlFor="workspace-item-path">{dialog === 'move' ? 'Destination path' : 'Name'}</label><TextInput id="workspace-item-path" label="Workspace item name" value={dialogValue} onChange={setDialogValue} placeholder={dialog === 'move' ? 'src/new-name.ts' : 'README.md'} maxLength={2048} /><div className="dialog-actions"><Button className="quiet-button" onClick={() => setDialog(null)} disabled={busy}>Cancel</Button><Button className="primary-button" type="submit" disabled={!dialogValue.trim() || busy}>{busy ? 'Working…' : 'Continue'}</Button></div></form></section></div>}
    {deleteTarget && <div className="modal-backdrop"><section className="dialog delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="workspace-delete-title"><div className="dialog-top"><span className="dialog-kicker">DELETE LOCAL ITEM</span><IconButton label="Cancel delete" onClick={() => setDeleteTarget(null)}>×</IconButton></div><h2 id="workspace-delete-title">Delete “{deleteTarget.name}”?</h2><p>This permanently deletes this item from the local project folder{deleteTarget.type === 'directory' ? ', including its contents' : ''}.</p><div className="dialog-actions"><Button className="quiet-button" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</Button><Button className="danger-button" onClick={deleteSelected} disabled={busy}>{busy ? 'Deleting…' : 'Delete item'}</Button></div></section></div>}
    {closeTarget && <div className="modal-backdrop"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-tab-title"><div className="dialog-top"><span className="dialog-kicker">UNSAVED FILE</span></div><h2 id="close-tab-title">Save changes to {closeTarget.path.split('/').at(-1)}?</h2><p>This tab has unsaved changes. Save before closing, discard the edits, or keep the tab open.</p><div className="dialog-actions"><Button className="quiet-button" onClick={() => setCloseTarget(null)}>Cancel</Button><Button className="danger-button" onClick={() => closeFile(closeTarget.path, true)}>Discard</Button><Button className="primary-button" onClick={saveAndClose}>Save and close</Button></div></section></div>}
    {leaveConfirm && <div className="modal-backdrop"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="leave-workspace-title"><div className="dialog-top"><span className="dialog-kicker">UNSAVED WORKSPACE</span></div><h2 id="leave-workspace-title">Save your open file changes?</h2><p>Save all modified files before leaving this workspace, discard them, or stay here.</p><div className="dialog-actions"><Button className="quiet-button" onClick={() => { setLeaveConfirm(false); setLeaveTarget(null); }}>Stay</Button><Button className="danger-button" onClick={finishLeaving}>Discard changes</Button><Button className="primary-button" onClick={saveAndLeave}>Save all</Button></div></section></div>}
    {copyTarget && <div className="modal-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="save-copy-title"><div className="dialog-top"><span className="dialog-kicker">RECOVER UNSAVED EDITS</span><IconButton label="Cancel save copy" onClick={() => setCopyTarget(null)}>×</IconButton></div><h2 id="save-copy-title">Save edits as a new file</h2><p>The original file changed outside BUILDX. Saving a copy preserves your unsaved version without overwriting the newer file.</p><form onSubmit={saveCopy}><label htmlFor="save-copy-path">New file name</label><TextInput id="save-copy-path" label="New file name" value={copyPath} onChange={setCopyPath} maxLength={255} /><div className="dialog-actions"><Button className="quiet-button" onClick={() => setCopyTarget(null)} disabled={busy}>Cancel</Button><Button className="primary-button" type="submit" disabled={!copyPath.trim() || busy}>{busy ? 'Saving…' : 'Save copy'}</Button></div></form></section></div>}
  </section>;
}

function RendererErrorBoundary({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <main className="error-screen" role="alert"><span className="eyebrow">BUILDX / STARTUP</span><h1>Something interrupted startup.</h1><p>Close and reopen BUILDX. If the problem continues, check the development log.</p></main>;
    return this.props.children;
  }
}

function AppContent() {
  const currentDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const [appInfo, setAppInfo] = useState(null);
  const [error, setError] = useState('');
  const [section, setSection] = useState('home');
  const [activeTab, setActiveTab] = useState('Overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState('create');
  const [editingProject, setEditingProject] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectType, setProjectType] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState('');
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [workspaceProjectId, setWorkspaceProjectId] = useState(null);
  const [toast, setToast] = useState('');
  const menuRef = useRef(null);
  const dialogRef = useRef(null);
  const deleteDialogRef = useRef(null);
  const paletteRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const paletteTriggerRef = useRef(null);
  const returnFocusRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    let isMounted = true;
    const bridge = window.buildxDesktop;
    if (!bridge || typeof bridge.getAppInfo !== 'function' || typeof bridge.listProjects !== 'function') {
      setError('The desktop bridge is unavailable. Restart BUILDX to reconnect.');
      setProjectsError('The project service is unavailable. Restart BUILDX and retry.');
      setProjectsLoading(false);
      return () => { isMounted = false; };
    }
    bridge.getAppInfo().then((info) => { if (isMounted) setAppInfo(info); })
      .catch(() => { if (isMounted) setError('BUILDX could not read desktop runtime information.'); });
    bridge.listProjects().then((items) => {
      if (isMounted) setProjects(Array.isArray(items) ? items : []);
    }).catch((loadError) => {
      if (isMounted) setProjectsError(loadError.message || 'BUILDX could not load projects.');
    }).finally(() => {
      if (isMounted) setProjectsLoading(false);
    });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette(document.activeElement);
      } else if (event.key === 'Escape') {
        if (paletteOpen) closePalette();
        else if (deleteTarget) setDeleteTarget(null);
        else if (dialogOpen) closeDialog();
        else if (menuOpen) closeMenu(true);
      } else if ((dialogOpen || paletteOpen || deleteTarget) && event.key === 'Tab') {
        const overlay = paletteOpen ? paletteRef.current : deleteTarget ? deleteDialogRef.current : dialogRef.current;
        const focusable = [...(overlay?.querySelectorAll('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') || [])];
        if (focusable.length) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      } else if (paletteOpen && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        const items = [...(paletteRef.current?.querySelectorAll('.command-item') || [])];
        if (items.length) {
          event.preventDefault();
          const currentIndex = items.indexOf(document.activeElement);
          const next = event.key === 'ArrowDown'
            ? (currentIndex + 1) % items.length
            : (currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
          items[next].focus();
        }
      } else if (menuOpen && menuRef.current && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
        if (items.length) {
          event.preventDefault();
          const currentIndex = items.indexOf(document.activeElement);
          const next = event.key === 'ArrowDown'
            ? (currentIndex + 1) % items.length
            : (currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
          items[next].focus();
        }
      } else if (menuOpen && event.key === 'Tab') {
        closeMenu(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen, paletteOpen, menuOpen, deleteTarget]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (dialogOpen) dialogRef.current?.querySelector('input')?.focus();
  }, [dialogOpen]);
  useEffect(() => {
    if (deleteTarget) deleteDialogRef.current?.querySelector('button')?.focus();
  }, [deleteTarget]);

  function notify(message) {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2800);
  }
  function openDialog(event, mode = 'create', project = null) {
    returnFocusRef.current = event?.currentTarget || (menuOpen ? menuTriggerRef.current : document.activeElement);
    setDialogMode(mode);
    setEditingProject(project);
    setProjectName(project?.name || '');
    setProjectDescription(project?.description || '');
    setProjectType(project?.project_type || '');
    setFormError('');
    setDialogOpen(true);
  }
  function closeDialog() {
    setDialogOpen(false);
    setFormError('');
    window.setTimeout(() => returnFocusRef.current?.focus?.(), 0);
  }
  function openPalette(trigger = document.activeElement) {
    paletteTriggerRef.current = trigger;
    setQuery('');
    setPaletteOpen(true);
  }
  function closePalette(restoreFocus = true) {
    setPaletteOpen(false);
    if (restoreFocus) window.setTimeout(() => paletteTriggerRef.current?.focus?.(), 0);
  }
  function closeMenu(restoreFocus = false) {
    setMenuOpen(false);
    if (restoreFocus) window.setTimeout(() => menuTriggerRef.current?.focus?.(), 0);
  }
  function selectSection(id) {
    if (id !== section) {
      const request = new CustomEvent('buildx:navigate', { detail: { section: id }, cancelable: true });
      window.dispatchEvent(request);
      if (request.defaultPrevented) return;
    }
    setSection(id);
    const label = sections.find((item) => item.id === id)?.label || 'Overview';
    setActiveTab(label);
  }
  async function refreshProjects(quiet = false) {
    if (!quiet) setProjectsLoading(true);
    setProjectsError('');
    try {
      const items = await window.buildxDesktop.listProjects();
      setProjects(Array.isArray(items) ? items : []);
      setActiveProjectId((current) => (items.some((item) => item.id === current) ? current : null));
      return true;
    } catch (loadError) {
      setProjectsError(loadError.message || 'BUILDX could not load projects.');
      return false;
    } finally {
      if (!quiet) setProjectsLoading(false);
    }
  }

  async function saveProject(event) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name || isSaving) return;
    setIsSaving(true);
    setFormError('');
    const payload = {
      name,
      description: projectDescription.trim() || null,
      project_type: projectType.trim() || null,
    };
    try {
      if (dialogMode === 'edit' && editingProject) {
        const updated = await window.buildxDesktop.updateProject(editingProject.id, payload);
        setProjects((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        notify(`“${updated.name}” was updated.`);
      } else {
        const created = await window.buildxDesktop.createProject(payload);
        setProjects((current) => [created, ...current]);
        setActiveProjectId(created.id);
        notify(`Project “${created.name}” was created.`);
      }
      closeDialog();
      selectSection('projects');
      await refreshProjects(true);
    } catch (saveError) {
      setFormError(saveError.message || 'BUILDX could not save this project.');
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmDeleteProject() {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      await window.buildxDesktop.deleteProject(deleteTarget.id);
      setProjects((current) => current.filter((project) => project.id !== deleteTarget.id));
      setActiveProjectId((current) => (current === deleteTarget.id ? null : current));
      notify(`Project “${deleteTarget.name}” was deleted. Its local files were not changed.`);
      setDeleteTarget(null);
    } catch (deleteError) {
      setProjectsError(deleteError.message || 'BUILDX could not delete this project.');
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  }
  async function chooseProjectDirectory(project) {
    try {
      const result = await window.buildxDesktop.chooseProjectDirectory(project.id);
      if (result?.canceled) return result;
      setProjects((current) => current.map((item) => item.id === result.project.id ? result.project : item));
      setActiveProjectId(result.project.id);
      notify(`Folder associated with “${result.project.name}”.`);
      return result;
    } catch (directoryError) {
      setProjectsError(directoryError.message || 'The project folder could not be selected.');
      return null;
    }
  }
  function runCommand(command) {
    if (command === 'new') openDialog();
    if (command === 'projects') selectSection('projects');
    if (command === 'planner') selectSection('planner');
    if (command === 'tasks') selectSection('tasks');
    if (command === 'settings') selectSection('settings');
    closePalette(false);
  }

  const commands = [
    { id: 'new', label: 'Create a project', detail: 'Start a local project record', icon: '+' },
    { id: 'projects', label: 'Go to projects', detail: 'Browse your projects', icon: '▤' },
    { id: 'planner', label: 'Open project planner', detail: 'Generate and review project plans', icon: '✳' },
    { id: 'tasks', label: 'Go to tasks', detail: 'See what is in progress', icon: '☷' },
    { id: 'settings', label: 'Open settings', detail: 'Configure BUILDX', icon: '⚙' },
  ].filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));
  const activeProject = projects.find((project) => project.id === activeProjectId) || null;

  return (
    <main className="app-frame">
      <aside className="app-rail" aria-label="Primary navigation">
        <a className="brand-mark" href="#home" aria-label="BUILDX home" onClick={() => selectSection('home')}>B</a>
        <div className="rail-items">
          {sections.map((item) => <button key={item.id} className={`rail-button ${section === item.id ? 'selected' : ''}`} onClick={() => selectSection(item.id)} aria-label={item.label} aria-current={section === item.id ? 'page' : undefined} title={item.label}><span aria-hidden="true">{item.icon}</span></button>)}
        </div>
        <button className="rail-avatar" aria-label="Account menu" onClick={() => notify('Account settings are coming in a later phase.')}>D</button>
      </aside>

      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <div className="workspace-heading">
          <div className="workspace-monogram">B</div>
          <div className="workspace-title"><strong>BUILDX</strong><span>Personal workspace</span></div>
          <IconButton label="Workspace options" onClick={() => { menuTriggerRef.current = document.activeElement; setMenuOpen((open) => !open); }}>···</IconButton>
          {menuOpen && <div className="dropdown" role="menu" ref={menuRef}><button type="button" role="menuitem" onClick={() => { closeMenu(); notify('Workspace settings are coming in a later phase.'); }}>Workspace settings</button><button type="button" role="menuitem" onClick={(event) => { closeMenu(); openDialog(event); }}>Create project</button></div>}
        </div>
        <Button className="search-trigger" onClick={(event) => openPalette(event.currentTarget)}><span className="search-symbol">⌕</span><span>Search anything</span><kbd>⌘ K</kbd></Button>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="sidebar-nav">
          {sections.map((item) => <button key={item.id} className={`sidebar-link ${section === item.id ? 'active' : ''}`} onClick={() => selectSection(item.id)}><span className="sidebar-icon" aria-hidden="true">{item.icon}</span>{item.label}{item.id === 'projects' && <span className="link-count">{projects.length}</span>}</button>)}
        </nav>
        <div className="sidebar-bottom"><div className="connection-mark"><span className="status-dot" />LOCAL ONLY</div><p>Project records are stored<br />in your local database.</p></div>
      </aside>

      <section className="main-area" aria-label="Main workspace">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{sections.find((item) => item.id === section)?.label}</strong></div>
          <div className="topbar-actions"><span className="runtime-label"><span className="status-dot" />{error ? 'Bridge offline' : appInfo ? 'Desktop ready' : 'Starting'}</span><Button className="quiet-button" onClick={() => notify('Projects are stored on this device.')}>Help <span aria-hidden="true">↗</span></Button></div>
        </header>
        <div className="tabbar">
          <Tabs tabs={['Overview', ...(activeTab !== 'Overview' ? [activeTab] : [])]} activeTab={activeTab} onSelect={(tab) => { if (tab === 'Overview') selectSection('home'); else setActiveTab(tab); }} />
          <button className="add-tab" aria-label="Open new workspace tab" onClick={() => { const tab = `View ${Date.now().toString().slice(-3)}`; setActiveTab(tab); notify('Temporary view opened.'); }}>+</button>
          <span className="tabbar-spacer" />
          <Button className="toolbar-action" onClick={(event) => openPalette(event.currentTarget)}><span aria-hidden="true">⌕</span> Quick switch <kbd>⌘ K</kbd></Button>
        </div>

        <div className="content-scroll" role="tabpanel" id="workspace-panel">
          <div className="content-wrap">
            {section === 'home' ? <>
              <div className="page-heading"><div><div className="eyebrow">{currentDate.toUpperCase()}</div><h1>Your workspace, <span>in focus.</span></h1><p>A quiet place to shape your next idea. Start by creating a project or explore what’s here.</p></div><Button className="primary-button" onClick={openDialog}><span aria-hidden="true">＋</span> New project</Button></div>
              <section className="welcome-panel" aria-labelledby="welcome-title">
                <div className="welcome-topline"><span className="panel-index">01 / YOUR STARTING POINT</span><span className="local-pill"><span className="status-dot" />LOCAL</span></div>
                <div className="welcome-layout"><div className="welcome-copy"><span className="welcome-mark" aria-hidden="true">✳</span><h2 id="welcome-title">Good work starts<br />with <em>room to think.</em></h2><p>Bring a project into focus by saving its details in your local BUILDX database.</p><Button className="primary-button" onClick={openDialog}>Create a project <span aria-hidden="true">↗</span></Button></div>
                  <div className="workspace-preview" aria-label="Workspace preview"><div className="preview-head"><span>WORKSPACE PREVIEW</span><span className="preview-dots">•••</span></div><div className="preview-line strong-line"><i />Workspace overview</div><div className="preview-line"><i />Your project notes</div><div className="preview-line"><i />Tasks & milestones</div><div className="preview-rule" /><div className="preview-placeholder"><span className="preview-plus">＋</span><span>Your first workspace<br /><small>Start with a name and an idea</small></span></div><div className="preview-foot"><span><span className="status-dot" /> LOCAL DESKTOP</span><span>READY TO CREATE</span></div></div>
                </div>
                <div className="panel-bottom"><span>Everything begins here.</span><span>BUILDX / 01</span></div>
              </section>
              <div className="section-heading"><div><span className="eyebrow">A CLEAR START</span><h2>Make this space yours</h2></div><button className="text-button" onClick={() => { selectSection('projects'); }}>Browse workspace <span aria-hidden="true">→</span></button></div>
              <div className="starter-row"><button type="button" className="starter-item" onClick={openDialog}><span className="starter-icon" aria-hidden="true">＋</span><span><strong>Create a project</strong><small>Keep project details together</small></span><span className="starter-arrow" aria-hidden="true">↗</span></button><button type="button" className="starter-item" onClick={(event) => openPalette(event.currentTarget)}><span className="starter-icon search-starter" aria-hidden="true">⌕</span><span><strong>Find your way around</strong><small>Search actions with Quick switch</small></span><span className="starter-arrow" aria-hidden="true">⌘K</span></button><button type="button" className="starter-item" onClick={() => selectSection('projects')}><span className="starter-icon" aria-hidden="true">◫</span><span><strong>Browse project files</strong><small>Choose a project folder and explore</small></span><span className="starter-arrow" aria-hidden="true">↗</span></button></div>
            </> : section === 'projects' ? workspaceProjectId && projects.find((item) => item.id === workspaceProjectId)?.root_path
              ? <WorkspaceExplorer project={projects.find((item) => item.id === workspaceProjectId)} onBack={() => setWorkspaceProjectId(null)} onNavigateSection={(id) => { setWorkspaceProjectId(null); setSection(id); setActiveTab(sections.find((item) => item.id === id)?.label || 'Overview'); }} onChangeFolder={() => chooseProjectDirectory(projects.find((item) => item.id === workspaceProjectId))} />
              : <ProjectManagementView projects={projects} selectedProject={activeProject} loading={projectsLoading} error={projectsError} onRetry={() => refreshProjects()} onCreate={(event) => openDialog(event)} onSelect={(id) => { setActiveProjectId(id); setWorkspaceProjectId(null); }} onEdit={(project) => openDialog(document.activeElement, 'edit', project)} onDelete={(project) => setDeleteTarget(project)} onChooseDirectory={chooseProjectDirectory} onOpenWorkspace={(project) => { setWorkspaceProjectId(project.id); setActiveProjectId(project.id); }} onPlanProject={(project) => { setActiveProjectId(project.id); selectSection('planner'); }} />
              : section === 'planner' ? <ProjectPlanner projects={projects} selectedProject={activeProject} onProjectChange={setActiveProjectId} />
                : section === 'settings' ? <AISettings /> : <section className="empty-view"><div className="empty-icon">{sections.find((item) => item.id === section)?.icon}</div><span className="eyebrow">{sections.find((item) => item.id === section)?.label.toUpperCase()}</span><h1>{section === 'tasks' ? 'A little room for what’s next.' : 'Your setup, at your pace.'}</h1><p>{section === 'tasks' ? 'Task tracking is not connected yet. This space will take shape in a later phase.' : 'Desktop preferences will be available in a later phase.'}</p><span className="later-pill">NOT CONNECTED YET <span>·</span> LATER PHASE</span></section>}
          </div>
        </div>
        <footer className="statusbar"><div className="status-left"><span><i className="status-dot" />LOCAL ONLY</span><span className="status-divider" /><span>SECURE DESKTOP</span></div><div className="status-right"><span>{appInfo ? `BUILDX ${appInfo.version}` : 'BUILDX'}</span><span className="status-divider" /><span>EARLY ACCESS</span></div></footer>
      </section>

      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
      {dialogOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={dialogRef}><div className="dialog-top"><span className="dialog-kicker">PROJECT DETAILS</span><IconButton label="Close dialog" onClick={closeDialog}>×</IconButton></div><h2 id="dialog-title">{dialogMode === 'edit' ? 'Edit project' : 'Create a project'}</h2><p>Project details are saved in the local BUILDX database. Directory operations are handled separately.</p><form onSubmit={saveProject}><label htmlFor="project-name">Project name</label><TextInput id="project-name" label="Project name" value={projectName} onChange={setProjectName} placeholder="e.g. Atlas redesign" maxLength={120} /><label htmlFor="project-description">Description <span className="optional-label">OPTIONAL</span></label><textarea id="project-description" aria-label="Description" value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} maxLength={2000} rows={3} placeholder="What are you building?" /><label htmlFor="project-type">Project type <span className="optional-label">OPTIONAL</span></label><select id="project-type" aria-label="Project type" value={projectType} onChange={(event) => setProjectType(event.target.value)}><option value="">Choose a type</option><option value="Python">Python</option><option value="JavaScript">JavaScript</option><option value="TypeScript">TypeScript</option><option value="Web">Web</option><option value="Other">Other</option></select>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><Button className="quiet-button" onClick={closeDialog} disabled={isSaving}>Cancel</Button><Button className="primary-button" type="submit" disabled={!projectName.trim() || isSaving}>{isSaving ? 'Saving…' : dialogMode === 'edit' ? 'Save changes' : 'Create project'} <span aria-hidden="true">→</span></Button></div></form></section></div>}
      {deleteTarget && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}><section className="dialog delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" ref={deleteDialogRef}><div className="dialog-top"><span className="dialog-kicker">REMOVE PROJECT RECORD</span><IconButton label="Close confirmation" onClick={() => setDeleteTarget(null)}>×</IconButton></div><h2 id="delete-title">Delete “{deleteTarget.name}”?</h2><p>This removes the project record from BUILDX. Its local directory and files will not be deleted.</p><div className="dialog-actions"><Button className="quiet-button" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>Keep project</Button><Button className="danger-button" onClick={confirmDeleteProject} disabled={isDeleting}>{isDeleting ? 'Deleting…' : 'Delete project'}</Button></div></section></div>}
      {paletteOpen && <div className="modal-backdrop palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closePalette(); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Quick switch" ref={paletteRef}><div className="palette-input-wrap"><span aria-hidden="true">⌕</span><input autoFocus aria-label="Search commands" placeholder="Search actions and views…" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>ESC</kbd></div><div className="palette-label">SUGGESTED</div><div className="command-list">{commands.length ? commands.map((command, index) => <button type="button" key={command.id} className="command-item" onClick={() => runCommand(command.id)}><span className="command-icon" aria-hidden="true">{command.icon}</span><span><strong>{command.label}</strong><small>{command.detail}</small></span>{index === 0 && <kbd aria-hidden="true">↵</kbd>}</button>) : <p className="no-results">No matching actions. Try another search.</p>}</div><div className="palette-footer"><span>↑ ↓ TO NAVIGATE</span><span>↵ TO SELECT</span><span>ESC TO CLOSE</span></div></section></div>}
    </main>
  );
}

export default function App() { return <RendererErrorBoundary><AppContent /></RendererErrorBoundary>; }
