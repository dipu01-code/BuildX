import React, { useEffect, useMemo, useState } from 'react';

const PRIORITIES = ['must', 'should', 'could'];
const emptyLines = (value) => (value || []).join('\n');
const lines = (value) => value.split('\n').map((line) => line.trim()).filter(Boolean);
const tokens = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);
const makeId = (prefix) => `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`}`;

function Field({ label, value, onChange, multiline = false, maxLength, placeholder = '' }) {
  const Component = multiline ? 'textarea' : 'input';
  return <label className="planner-field">{label}<Component value={value ?? ''} maxLength={maxLength} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function LinesField({ label, value, onChange, placeholder = 'One item per line' }) {
  return <Field label={label} value={emptyLines(value)} multiline placeholder={placeholder} onChange={(text) => onChange(lines(text))} />;
}

function PriorityField({ value, onChange }) {
  return <label className="planner-field">Priority<select value={value} onChange={(event) => onChange(event.target.value)}>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>;
}

function IdentifierListField({ label, value, onChange }) {
  return <Field label={label} value={(value || []).join(', ')} placeholder="Comma separated IDs" onChange={(text) => onChange(tokens(text))} />;
}

function RequirementsEditor({ requirements, onChange }) {
  function update(index, next) { onChange(requirements.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item)); }
  return <section className="planner-section"><div className="planner-section-heading"><div><span className="eyebrow">01 / SCOPE</span><h2>Requirements</h2></div><button className="text-button" type="button" onClick={() => onChange([...requirements, { id: makeId('req'), title: 'New requirement', description: '', priority: 'should', acceptance_criteria: [''], dependencies: [] }])}>＋ Add requirement</button></div>
    {requirements.map((item, index) => <article className="planner-item" key={item.id}><div className="planner-item-heading"><strong>{item.id}</strong><button className="text-button" type="button" onClick={() => onChange(requirements.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div><div className="planner-fields"><Field label="Title" value={item.title} maxLength={160} onChange={(title) => update(index, { title })} /><PriorityField value={item.priority} onChange={(priority) => update(index, { priority })} /><Field label="Description" value={item.description} multiline maxLength={1500} onChange={(description) => update(index, { description })} /><LinesField label="Acceptance criteria" value={item.acceptance_criteria} onChange={(acceptance_criteria) => update(index, { acceptance_criteria })} /><IdentifierListField label="Requirement dependencies" value={item.dependencies} onChange={(dependencies) => update(index, { dependencies })} /></div></article>)}
  </section>;
}

function MilestonesEditor({ milestones, onChange }) {
  function updateMilestone(index, next) { onChange(milestones.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item)); }
  function updateTask(milestoneIndex, taskIndex, next) {
    const milestone = milestones[milestoneIndex];
    updateMilestone(milestoneIndex, { tasks: milestone.tasks.map((task, index) => index === taskIndex ? { ...task, ...next } : task) });
  }
  return <section className="planner-section"><div className="planner-section-heading"><div><span className="eyebrow">02 / DELIVERY</span><h2>Milestones and tasks</h2></div><button className="text-button" type="button" onClick={() => onChange([...milestones, { id: makeId('mile'), title: 'New milestone', goal: '', tasks: [{ id: makeId('task'), title: 'New task', description: '', rationale: '', priority: 'should', estimated_effort: null, dependencies: [], acceptance_criteria: [''], suggested_milestone: null }], completion_criteria: [''] }])}>＋ Add milestone</button></div>
    {milestones.map((milestone, milestoneIndex) => <article className="planner-item planner-milestone" key={milestone.id}><div className="planner-item-heading"><strong>{milestone.id}</strong><button className="text-button" type="button" onClick={() => onChange(milestones.filter((_, index) => index !== milestoneIndex))}>Remove milestone</button></div><div className="planner-fields"><Field label="Milestone title" value={milestone.title} maxLength={160} onChange={(title) => updateMilestone(milestoneIndex, { title })} /><Field label="Goal" value={milestone.goal} multiline maxLength={1000} onChange={(goal) => updateMilestone(milestoneIndex, { goal })} /><LinesField label="Completion criteria" value={milestone.completion_criteria} onChange={(completion_criteria) => updateMilestone(milestoneIndex, { completion_criteria })} /></div>
      <div className="planner-task-list"><div className="planner-section-heading"><h3>Tasks</h3><button className="text-button" type="button" onClick={() => updateMilestone(milestoneIndex, { tasks: [...milestone.tasks, { id: makeId('task'), title: 'New task', description: '', rationale: '', priority: 'should', estimated_effort: null, dependencies: [], acceptance_criteria: [''], suggested_milestone: milestone.title }] })}>＋ Add task</button></div>
        {milestone.tasks.map((task, taskIndex) => <div className="planner-task" key={task.id}><div className="planner-item-heading"><strong>{task.id}</strong><button className="text-button" type="button" onClick={() => updateMilestone(milestoneIndex, { tasks: milestone.tasks.filter((_, index) => index !== taskIndex) })}>Remove task</button></div><div className="planner-fields"><Field label="Task title" value={task.title} maxLength={160} onChange={(title) => updateTask(milestoneIndex, taskIndex, { title })} /><PriorityField value={task.priority} onChange={(priority) => updateTask(milestoneIndex, taskIndex, { priority })} /><Field label="Description" value={task.description} multiline maxLength={1500} onChange={(description) => updateTask(milestoneIndex, taskIndex, { description })} /><Field label="Rationale" value={task.rationale} multiline maxLength={1000} onChange={(rationale) => updateTask(milestoneIndex, taskIndex, { rationale })} /><IdentifierListField label="Task dependencies" value={task.dependencies} onChange={(dependencies) => updateTask(milestoneIndex, taskIndex, { dependencies })} /><LinesField label="Acceptance criteria" value={task.acceptance_criteria} onChange={(acceptance_criteria) => updateTask(milestoneIndex, taskIndex, { acceptance_criteria })} /><Field label="Rough effort estimate" value={task.estimated_effort || ''} maxLength={100} placeholder="Optional; label as a rough estimate" onChange={(estimated_effort) => updateTask(milestoneIndex, taskIndex, { estimated_effort: estimated_effort || null })} /><Field label="Suggested phase or milestone" value={task.suggested_milestone || ''} maxLength={160} onChange={(suggested_milestone) => updateTask(milestoneIndex, taskIndex, { suggested_milestone: suggested_milestone || null })} /></div></div>)}
      </div>
    </article>)}
  </section>;
}

function PlanEditor({ draft, setDraft, isSaved }) {
  function update(field, value) { setDraft((current) => ({ ...current, [field]: value })); }
  const updateRecommendations = (field, value) => setDraft((current) => ({ ...current, recommendations: { ...current.recommendations, [field]: value } }));
  return <div className="planner-review">
    <div className="planner-trust-note"><strong>{isSaved ? 'AI-generated plan · Saved and approved' : 'AI-generated draft · Unapproved'}</strong><span>Estimates and recommendations are suggestions, not verified facts. {isSaved ? 'Any edits are saved only after you choose Save changes.' : 'Review and edit before saving; nothing will run or change project files.'}</span></div>
    <section className="planner-section"><div className="planner-section-heading"><div><span className="eyebrow">PROJECT SUMMARY</span><h2>Summary and assumptions</h2></div></div><div className="planner-fields"><Field label="Project title" value={draft.project_title} maxLength={160} onChange={(value) => update('project_title', value)} /><Field label="Problem statement" value={draft.problem_statement} multiline maxLength={2000} onChange={(value) => update('problem_statement', value)} /><LinesField label="Intended users" value={draft.intended_users} onChange={(value) => update('intended_users', value)} /><LinesField label="Main objectives" value={draft.main_objectives} onChange={(value) => update('main_objectives', value)} /><LinesField label="Assumptions" value={draft.assumptions} onChange={(value) => update('assumptions', value)} /><LinesField label="Out of scope" value={draft.out_of_scope} onChange={(value) => update('out_of_scope', value)} /></div></section>
    <RequirementsEditor requirements={draft.requirements} onChange={(requirements) => update('requirements', requirements)} />
    <MilestonesEditor milestones={draft.milestones} onChange={(milestones) => update('milestones', milestones)} />
    <section className="planner-section"><div className="planner-section-heading"><div><span className="eyebrow">03 / TECHNICAL DIRECTION</span><h2>Recommendations</h2></div></div><div className="planner-fields"><Field label="Recommended technology stack" value={draft.recommendations.recommended_stack.map((entry) => `${entry.technology} — ${entry.reason}`).join('\n')} multiline placeholder="One technology and reason per line" onChange={(text) => updateRecommendations('recommended_stack', lines(text).map((line) => { const [technology, ...reason] = line.split('—'); return { technology: technology.trim(), reason: reason.join('—').trim() || 'Reason not supplied' }; }))} /><Field label="High-level architecture" value={draft.recommendations.architecture} multiline maxLength={4000} onChange={(value) => updateRecommendations('architecture', value)} /><Field label="Risks and mitigations" value={draft.recommendations.risks.map((item) => `${item.risk} — ${item.mitigation}`).join('\n')} multiline placeholder="One risk and mitigation per line" onChange={(text) => updateRecommendations('risks', lines(text).map((line) => { const [risk, ...mitigation] = line.split('—'); return { risk: risk.trim(), mitigation: mitigation.join('—').trim() || 'Mitigation not supplied' }; }))} /><LinesField label="Testing strategy" value={draft.recommendations.testing_strategy} onChange={(value) => updateRecommendations('testing_strategy', value)} /><LinesField label="Security considerations" value={draft.recommendations.security_considerations} onChange={(value) => updateRecommendations('security_considerations', value)} /></div></section>
  </div>;
}

function validateDraft(draft) {
  const errors = [];
  const checkText = (value, label, max, required = true) => {
    if (typeof value !== 'string' || (required && !value.trim())) errors.push(`${label} is required.`);
    else if (value.length > max) errors.push(`${label} must be ${max} characters or fewer.`);
  };
  const checkLines = (values, label, minimum, maximum, itemMaximum) => {
    if (!Array.isArray(values) || values.length < minimum || values.length > maximum) errors.push(`${label} must contain ${minimum === maximum ? minimum : `between ${minimum} and ${maximum}`} items.`);
    else values.forEach((value, index) => checkText(value, `${label} item ${index + 1}`, itemMaximum));
  };
  checkText(draft.project_title, 'Project title', 160);
  checkText(draft.problem_statement, 'Problem statement', 2000);
  checkLines(draft.intended_users, 'Intended users', 1, 20, 160);
  checkLines(draft.main_objectives, 'Main objectives', 1, 20, 500);
  checkLines(draft.assumptions, 'Assumptions', 0, 20, 500);
  checkLines(draft.out_of_scope, 'Out-of-scope items', 0, 20, 500);
  if (draft.requirements.length < 1 || draft.requirements.length > 50) errors.push('Plans need between 1 and 50 requirements.');
  for (const requirement of draft.requirements) {
    checkText(requirement.title, `${requirement.id} title`, 160);
    checkText(requirement.description, `${requirement.id} description`, 1500);
    checkLines(requirement.acceptance_criteria, `${requirement.id} acceptance criteria`, 1, 10, 500);
    if (!PRIORITIES.includes(requirement.priority)) errors.push(`${requirement.id} has an invalid priority.`);
    if (requirement.dependencies.length > 30) errors.push(`${requirement.id} has too many dependencies.`);
  }
  const tasks = draft.milestones.flatMap((milestone) => milestone.tasks);
  if (draft.milestones.length < 1 || draft.milestones.length > 20) errors.push('Plans need between 1 and 20 milestones.');
  if (tasks.length > 120) errors.push('Plans cannot contain more than 120 tasks.');
  for (const milestone of draft.milestones) {
    checkText(milestone.title, `${milestone.id} title`, 160);
    checkText(milestone.goal, `${milestone.id} goal`, 1000);
    checkLines(milestone.completion_criteria, `${milestone.id} completion criteria`, 1, 10, 500);
    if (!milestone.tasks.length || milestone.tasks.length > 30) errors.push(`${milestone.id} needs between 1 and 30 tasks.`);
    for (const task of milestone.tasks) {
      checkText(task.title, `${task.id} title`, 160);
      checkText(task.description, `${task.id} description`, 1500);
      checkText(task.rationale, `${task.id} rationale`, 1000);
      checkLines(task.acceptance_criteria, `${task.id} acceptance criteria`, 1, 10, 500);
      checkText(task.estimated_effort || '', `${task.id} effort estimate`, 100, false);
      checkText(task.suggested_milestone || '', `${task.id} suggested milestone`, 160, false);
      if (!PRIORITIES.includes(task.priority)) errors.push(`${task.id} has an invalid priority.`);
      if (task.dependencies.length > 30) errors.push(`${task.id} has too many dependencies.`);
    }
  }
  const identifiers = [...draft.requirements.map((item) => item.id), ...draft.milestones.map((item) => item.id), ...tasks.map((item) => item.id)];
  if (new Set(identifiers).size !== identifiers.length) errors.push('Plan identifiers must be unique.');
  for (const id of identifiers) if (!/^(req|mile|task)_[a-zA-Z0-9_-]{1,56}$/.test(id)) errors.push(`Plan identifier ${id} is invalid.`);
  const taskIds = new Set(tasks.map((task) => task.id));
  const requirementIds = new Set(draft.requirements.map((item) => item.id));
  for (const item of draft.requirements) for (const dependency of item.dependencies) if (!requirementIds.has(dependency)) errors.push(`${item.id} refers to missing requirement ${dependency}.`);
  const graph = new Map(tasks.map((task) => [task.id, task.dependencies]));
  for (const task of tasks) for (const dependency of task.dependencies) if (!taskIds.has(dependency)) errors.push(`${task.id} refers to missing task ${dependency}.`);
  const visiting = new Set(); const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push('Task dependencies contain a cycle.'); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id) || []) if (graph.has(dependency)) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of graph.keys()) visit(id);
  for (const task of tasks) for (const dependency of task.dependencies) if (dependency === task.id) errors.push(`${task.id} cannot depend on itself.`);
  const recommendations = draft.recommendations;
  checkText(recommendations.architecture, 'Architecture', 4000);
  if (recommendations.recommended_stack.length > 20) errors.push('Technology stack can contain at most 20 items.');
  for (const entry of recommendations.recommended_stack) { checkText(entry.technology, 'Technology name', 120); checkText(entry.reason, 'Technology reason', 500); }
  if (recommendations.risks.length > 20) errors.push('Risks can contain at most 20 items.');
  for (const risk of recommendations.risks) { checkText(risk.risk, 'Risk', 500); checkText(risk.mitigation, 'Risk mitigation', 500); }
  checkLines(recommendations.testing_strategy, 'Testing strategy', 1, 20, 500);
  checkLines(recommendations.security_considerations, 'Security considerations', 1, 20, 500);
  return [...new Set(errors)];
}

export default function ProjectPlanner({ projects, selectedProject, onProjectChange }) {
  const [projectId, setProjectId] = useState(selectedProject?.id || '');
  const [brief, setBrief] = useState(''); const [constraints, setConstraints] = useState('');
  const [stack, setStack] = useState(''); const [experience, setExperience] = useState('');
  const [priorities, setPriorities] = useState(''); const [draft, setDraft] = useState(null);
  const [savedPlans, setSavedPlans] = useState([]); const [savedId, setSavedId] = useState(null);
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const activeProject = useMemo(() => projects.find((project) => project.id === projectId) || null, [projects, projectId]);
  const validationErrors = draft ? validateDraft(draft) : [];

  useEffect(() => {
    setProjectId(selectedProject?.id || ''); setDraft(null); setSavedId(null); setError(''); setNotice('');
  }, [selectedProject?.id]);

  useEffect(() => {
    let current = true;
    if (!projectId) { setSavedPlans([]); return () => { current = false; }; }
    setBusy('list'); setError('');
    window.buildxDesktop.listProjectPlans(projectId).then((plans) => { if (current) setSavedPlans(plans); })
      .catch((loadError) => { if (current) setError(loadError.message || 'Saved plans could not be loaded.'); })
      .finally(() => { if (current) setBusy(''); });
    return () => { current = false; };
  }, [projectId]);

  async function generate(event) {
    event.preventDefault(); if (!projectId || !brief.trim() || busy) return;
    setBusy('generate'); setError(''); setNotice(''); setSavedId(null);
    try {
      const result = await window.buildxDesktop.generateProjectPlan(projectId, {
        project_brief: brief.trim(), constraints: constraints.trim() || null,
        preferred_technology_stack: tokens(stack), experience_level: experience || null,
        delivery_priorities: lines(priorities),
      });
      setDraft(result); setNotice('Draft generated. Review and edit it before saving.');
    } catch (generationError) { setError(generationError.message || 'The AI provider could not generate a plan.'); }
    finally { setBusy(''); }
  }

  async function openSavedPlan(planId) {
    if (!projectId || !planId || busy) return;
    setBusy('open'); setError(''); setNotice('');
    try { const result = await window.buildxDesktop.getProjectPlan(projectId, planId); setDraft(result.plan); setSavedId(result.id); }
    catch (loadError) { setError(loadError.message || 'This saved plan could not be opened.'); }
    finally { setBusy(''); }
  }

  async function saveDraft() {
    if (!draft || validationErrors.length || busy) return;
    setBusy('save'); setError(''); setNotice('');
    try {
      const saved = savedId
        ? await window.buildxDesktop.updateProjectPlan(projectId, savedId, draft)
        : await window.buildxDesktop.saveProjectPlan(projectId, draft);
      setDraft(saved.plan); setSavedId(saved.id);
      setSavedPlans((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setNotice('Plan saved on this device.');
    } catch (saveError) { setError(saveError.message || 'BUILDX could not save the plan.'); }
    finally { setBusy(''); }
  }

  async function deletePlan() {
    if (!deleteTarget || busy) return;
    setBusy('delete'); setError(''); setNotice('');
    try {
      await window.buildxDesktop.deleteProjectPlan(projectId, deleteTarget.id);
      setSavedPlans((current) => current.filter((item) => item.id !== deleteTarget.id));
      if (savedId === deleteTarget.id) { setSavedId(null); setDraft(null); }
      setNotice('Saved plan deleted. Project files were not changed.'); setDeleteTarget(null);
    } catch (deleteError) { setError(deleteError.message || 'BUILDX could not delete this plan.'); }
    finally { setBusy(''); }
  }

  function selectProject(value) { setProjectId(value); onProjectChange?.(value); setDraft(null); setSavedId(null); }

  return <section className="project-planner" aria-labelledby="planner-title">
    <div className="planner-heading"><div><span className="eyebrow">AI PROJECT PLANNER</span><h1 id="planner-title">Plan your project</h1><p>Turn a project brief into a structured plan you can review and save. Plans never run tasks or modify project files.</p></div></div>
    {!projects.length ? <div className="planner-empty"><h2>Create a project to begin</h2><p>The planner saves plans to a local project record.</p></div> : <>
      <div className="planner-project-picker"><label htmlFor="planner-project">Project</label><select id="planner-project" value={projectId} disabled={Boolean(busy)} onChange={(event) => selectProject(event.target.value)}><option value="">Choose a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>{activeProject && <span>{activeProject.description || activeProject.project_type || 'Local project'}</span>}</div>
      {projectId && <>
        <form className="planner-form" onSubmit={generate}><div className="planner-section-heading"><div><span className="eyebrow">DESCRIBE THE IDEA</span><h2>Project brief</h2></div></div><Field label="What do you want to build?" value={brief} onChange={setBrief} multiline maxLength={12000} placeholder="Describe the problem, who it helps, and the main outcome…" /><div className="planner-fields"><Field label="Constraints" value={constraints} onChange={setConstraints} multiline maxLength={4000} placeholder="Optional" /><Field label="Preferred technologies" value={stack} onChange={setStack} maxLength={1000} placeholder="Optional, comma separated" /><label className="planner-field">Experience level<select value={experience} onChange={(event) => setExperience(event.target.value)}><option value="">Not specified</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label><Field label="Delivery priorities" value={priorities} onChange={setPriorities} multiline maxLength={1000} placeholder="Optional, one per line" /></div><div className="planner-form-actions"><small>{brief.length.toLocaleString()} / 12,000 characters</small><button className="button primary-button" type="submit" disabled={!brief.trim() || Boolean(busy)}>{busy === 'generate' ? 'Generating…' : draft ? 'Regenerate plan' : 'Generate plan'} <span aria-hidden="true">→</span></button></div></form>
        <div className="planner-saved-row"><label htmlFor="saved-plans">Saved plans</label><select id="saved-plans" value={savedId || ''} onChange={(event) => openSavedPlan(event.target.value)} disabled={Boolean(busy) || !savedPlans.length}><option value="">{savedPlans.length ? 'Open a saved plan' : busy === 'list' ? 'Loading saved plans…' : 'No saved plans yet'}</option>{savedPlans.map((item) => <option key={item.id} value={item.id}>{item.plan.project_title} · {new Date(item.updated_at).toLocaleDateString()}</option>)}</select>{savedId && <button className="text-button" type="button" disabled={Boolean(busy)} onClick={() => setDeleteTarget(savedPlans.find((item) => item.id === savedId))}>Delete saved plan</button>}</div>
        {error && <p className="planner-message planner-error" role="alert">{error}</p>}{notice && <p className="planner-message planner-success" role="status">{notice}</p>}
        {draft && <><PlanEditor draft={draft} setDraft={setDraft} isSaved={Boolean(savedId)} />{validationErrors.length > 0 && <ul className="planner-validation" role="alert">{validationErrors.map((message) => <li key={message}>{message}</li>)}</ul>}<div className="planner-save-bar"><span>{savedId ? 'Editing saved plan' : 'Draft is not saved'} · Nothing will execute when you save</span><button type="button" className="button primary-button" disabled={Boolean(busy) || validationErrors.length > 0} onClick={saveDraft}>{busy === 'save' ? 'Saving…' : savedId ? 'Save changes' : 'Save approved plan'} <span aria-hidden="true">→</span></button></div></>}
      </>}
    </>}
    {deleteTarget && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeleteTarget(null); }}><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-plan-title"><div className="dialog-top"><span className="dialog-kicker">DELETE SAVED PLAN</span></div><h2 id="delete-plan-title">Delete “{deleteTarget.plan.project_title}”?</h2><p>This removes the saved plan record only. Project files will not be changed.</p><div className="dialog-actions"><button className="button quiet-button" type="button" disabled={Boolean(busy)} onClick={() => setDeleteTarget(null)}>Cancel</button><button className="button danger-button" type="button" disabled={Boolean(busy)} onClick={deletePlan}>{busy === 'delete' ? 'Deleting…' : 'Delete plan'}</button></div></section></div>}
  </section>;
}

export { validateDraft };
