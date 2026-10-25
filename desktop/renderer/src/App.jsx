import React, { Component, useEffect, useRef, useState } from 'react';

const sections = [
  { id: 'home', label: 'Overview', icon: '⌂' },
  { id: 'projects', label: 'Projects', icon: '▤' },
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
function Tabs({ tabs, activeTab, onSelect }) {
  return <div className="tab-list" role="tablist" aria-label="Workspace views">
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
  projects, selectedProject, loading, error, onRetry, onCreate, onSelect, onEdit, onDelete,
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
      <dl className="project-detail-list"><dt>Description</dt><dd>{selectedProject.description || 'No description added.'}</dd><dt>Project directory</dt><dd>{selectedProject.root_path || 'Not set. Choose a directory in the workspace phase.'}</dd></dl>
      <div className="project-detail-actions"><Button className="quiet-button" onClick={() => onEdit(selectedProject)}>Edit details</Button><Button className="danger-button" onClick={() => onDelete(selectedProject)}>Delete project</Button></div>
      <p className="project-delete-note">Deleting a project removes only its BUILDX record; local files are left untouched.</p>
    </article>}
    {!selectedProject && !loading && !projects.length && !error && <div className="workspace-list-empty"><div className="empty-icon">▤</div><h2>No projects yet</h2><p>Create a project record to keep its description and directory association in BUILDX.</p><Button className="primary-button" onClick={onCreate}>Create a project <span aria-hidden="true">↗</span></Button></div>}
    {!selectedProject && projects.length > 0 && <ul className="project-cards">{projects.map((project) => <li className="project-card" key={project.id}>
      <button className="project-card-open" type="button" onClick={() => onSelect(project.id)}><span className="project-card-mark" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span><span className="project-card-copy"><strong>{project.name}</strong><small>{project.description || project.project_type || 'No additional details'}</small></span><span className="project-card-date">Updated {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(project.updated_at))}</span></button>
      <div className="project-card-actions"><IconButton label={`Edit ${project.name}`} onClick={() => onEdit(project)}>✎</IconButton><IconButton label={`Delete ${project.name}`} onClick={() => onDelete(project)}>×</IconButton></div>
    </li>)}</ul>}
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
  function runCommand(command) {
    if (command === 'new') openDialog();
    if (command === 'projects') selectSection('projects');
    if (command === 'tasks') selectSection('tasks');
    if (command === 'settings') selectSection('settings');
    closePalette(false);
  }

  const commands = [
    { id: 'new', label: 'Create a project', detail: 'Start a local project record', icon: '+' },
    { id: 'projects', label: 'Go to projects', detail: 'Browse your projects', icon: '▤' },
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
          <Tabs tabs={['Overview', ...(activeTab !== 'Overview' ? [activeTab] : [])]} activeTab={activeTab} onSelect={(tab) => { setActiveTab(tab); if (tab === 'Overview') setSection('home'); }} />
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
              <div className="starter-row"><button type="button" className="starter-item" onClick={openDialog}><span className="starter-icon" aria-hidden="true">＋</span><span><strong>Create a project</strong><small>Keep project details together</small></span><span className="starter-arrow" aria-hidden="true">↗</span></button><button type="button" className="starter-item" onClick={(event) => openPalette(event.currentTarget)}><span className="starter-icon search-starter" aria-hidden="true">⌕</span><span><strong>Find your way around</strong><small>Search actions with Quick switch</small></span><span className="starter-arrow" aria-hidden="true">⌘K</span></button><div className="starter-item disabled-item"><span className="starter-icon" aria-hidden="true">◫</span><span><strong>Open a project folder</strong><small>Available in Phase 6</small></span><span className="later-label">LATER</span></div></div>
            </> : section === 'projects' ? <ProjectManagementView projects={projects} selectedProject={activeProject} loading={projectsLoading} error={projectsError} onRetry={() => refreshProjects()} onCreate={(event) => openDialog(event)} onSelect={(id) => setActiveProjectId(id)} onEdit={(project) => openDialog(document.activeElement, 'edit', project)} onDelete={(project) => setDeleteTarget(project)} /> : <section className="empty-view"><div className="empty-icon">{sections.find((item) => item.id === section)?.icon}</div><span className="eyebrow">{sections.find((item) => item.id === section)?.label.toUpperCase()}</span><h1>{section === 'tasks' ? 'A little room for what’s next.' : 'Your setup, at your pace.'}</h1><p>{section === 'tasks' ? 'Task tracking is not connected yet. This space will take shape in a later phase.' : 'Desktop preferences will be available in a later phase.'}</p><span className="later-pill">NOT CONNECTED YET <span>·</span> LATER PHASE</span></section>}
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
