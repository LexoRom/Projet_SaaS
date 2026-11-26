import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';
import { useSession } from '../App.jsx';
import { describeActivity, formatDateTime, formatDay, isManager, isOverdue, PRIORITIES } from '../format.js';
import { useLoad } from '../hooks.js';
import { Avatar, Field, Loading, Modal, useFeedback } from '../ui.jsx';
import ProjectSettings from './ProjectSettings.jsx';
import TaskModal from './TaskModal.jsx';

function CardBody({ task, project, usersById }) {
  const done = task.checklist.filter((item) => item.done).length;
  return (
    <>
      <div className="card-top">
        <code>{project.key}-{task.number}</code>
        <span className={`badge ${task.priority}`}>{PRIORITIES[task.priority]}</span>
      </div>
      <p>{task.title}</p>
      {task.labels.length > 0 && (
        <div className="labels">{task.labels.map((label) => <span key={label}>{label}</span>)}</div>
      )}
      <div className="card-bottom">
        {task.dueDate && <span className={isOverdue(task) ? 'late' : 'muted'}>📅 {formatDay(task.dueDate)}</span>}
        {task.checklist.length > 0 && <span className="muted">☑ {done}/{task.checklist.length}</span>}
        <span className="spacer" />
        <Avatar user={usersById.get(task.assigneeId)} />
      </div>
    </>
  );
}

function TaskCard({ task, onOpen, disabled, ...context }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task._id, disabled });
  return (
    <article
      ref={setNodeRef}
      className={isDragging ? 'task-card dragging' : 'task-card'}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task._id)}
      onKeyDown={(event) => {
        // Entrée ouvre la fiche ; Espace démarre le déplacement au clavier.
        if (event.key === 'Enter' && !isDragging) onOpen(task._id);
        else listeners?.onKeyDown?.(event);
      }}
    >
      <CardBody task={task} {...context} />
    </article>
  );
}

function Column({ column, ids, children, onAdd }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  return (
    <section className={isOver ? 'column over' : 'column'} aria-label={column.name}>
      <header>
        <h2>{column.name}{column.isDone && ' ✓'}</h2>
        <span className="muted">{ids.length}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="column-body" ref={setNodeRef}>{children}</div>
      </SortableContext>
      {onAdd && <button type="button" className="ghost add" onClick={onAdd}>+ Ajouter une tâche</button>}
    </section>
  );
}

const NO_FILTER = { search: '', assignee: '', priority: '', label: '' };

export default function Board() {
  const { projectId } = useParams();
  const { user, company } = useSession();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState(NO_FILTER);
  const [creatingIn, setCreatingIn] = useState(null);
  const [panel, setPanel] = useState(null);
  // Pendant un glisser-déposer : { colonne: [identifiants] }.
  const [dragLayout, setDragLayout] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const { attempt } = useFeedback();

  const { data, error, reload, setData } = useLoad(async () => {
    const [project, tasks, users] = await Promise.all([
      api(`/projects/${projectId}`),
      api(`/projects/${projectId}/tasks`),
      api('/users'),
    ]);
    return { project, tasks, users };
  }, [projectId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const usersById = useMemo(() => new Map((data?.users ?? []).map((u) => [u._id, u])), [data?.users]);

  if (!data) return <Loading error={error} />;
  const { project, tasks, users } = data;
  const columns = [...project.columns].sort((a, b) => a.order - b.order);
  const members = project.members.map((m) => usersById.get(m.userId)).filter(Boolean);
  const labels = [...new Set(tasks.flatMap((task) => task.labels))].sort();
  const tasksById = new Map(tasks.map((task) => [task._id, task]));

  const search = filters.search.trim().toLowerCase();
  const visible = tasks.filter(
    (task) =>
      (!search || task.title.toLowerCase().includes(search) || `${project.key}-${task.number}`.toLowerCase() === search) &&
      (!filters.assignee ||
        (filters.assignee === 'none' ? !task.assigneeId : task.assigneeId === filters.assignee)) &&
      (!filters.priority || task.priority === filters.priority) &&
      (!filters.label || task.labels.includes(filters.label)),
  );

  const layout =
    dragLayout ??
    Object.fromEntries(
      columns.map((column) => [
        column.key,
        visible.filter((t) => t.status === column.key).sort((a, b) => a.position - b.position).map((t) => t._id),
      ]),
    );

  const columnOf = (id, source) => (source[id] ? id : Object.keys(source).find((key) => source[key].includes(id)));

  const onDragStart = ({ active }) => {
    setActiveId(active.id);
    setDragLayout(layout);
  };

  const onDragOver = ({ active, over }) => {
    if (!over) return;
    setDragLayout((current) => {
      const from = columnOf(active.id, current);
      const to = columnOf(over.id, current);
      if (!from || !to || from === to) return current;
      const target = current[to];
      const overIndex = target.indexOf(over.id);
      const index = overIndex === -1 ? target.length : overIndex;
      return {
        ...current,
        [from]: current[from].filter((id) => id !== active.id),
        [to]: [...target.slice(0, index), active.id, ...target.slice(index)],
      };
    });
  };

  const stopDrag = () => {
    setDragLayout(null);
    setActiveId(null);
  };

  const onDragEnd = async ({ active, over }) => {
    const current = dragLayout;
    if (!over || !current) return stopDrag();
    const status = columnOf(active.id, current);
    let ids = current[status];
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    if (to !== -1 && from !== to) ids = arrayMove(ids, from, to);
    const index = ids.indexOf(active.id);
    const afterId = index > 0 ? ids[index - 1] : null;

    const task = tasksById.get(active.id);
    const original = tasks.filter((t) => t.status === status && ids.includes(t._id));
    const unchanged =
      task.status === status &&
      original.sort((a, b) => a.position - b.position).map((t) => t._id).join() === ids.join();
    if (unchanged) return stopDrag();

    // Affichage immédiat, puis rechargement de l'état réel renvoyé par le serveur.
    const previous = ids[index - 1] ? tasksById.get(ids[index - 1]).position : null;
    const next = ids[index + 1] ? tasksById.get(ids[index + 1]).position : null;
    const position =
      previous !== null && next !== null ? (previous + next) / 2 : previous !== null ? previous + 1 : next !== null ? next - 1 : 0;
    setData((value) => ({
      ...value,
      tasks: value.tasks.map((t) => (t._id === active.id ? { ...t, status, position } : t)),
    }));
    stopDrag();
    await attempt(() => api(`/tasks/${active.id}/move`, { method: 'POST', body: { status, afterId } }));
    reload();
  };

  const readOnly = project.archived;
  const openTaskId = params.get('tache');
  const openTask = (id) => setParams(id ? { tache: id } : {});
  const filter = (name) => (event) => setFilters({ ...filters, [name]: event.target.value });
  const mineOnly = filters.assignee === user._id;

  return (
    <div className="board-page">
      <div className="toolbar">
        <h1>
          <span className="dot" style={{ background: project.color }} />
          {project.name} <code>{project.key}</code>
        </h1>
        <button type="button" onClick={() => setPanel('activity')}>Activité</button>
        {isManager(user) && <button type="button" onClick={() => setPanel('settings')}>Gérer le projet</button>}
      </div>
      {readOnly && <p className="notice">Projet archivé : lecture seule.</p>}

      <div className="filters">
        <input type="search" placeholder="Rechercher un titre ou un identifiant" value={filters.search} onChange={filter('search')} />
        <select aria-label="Filtrer par assigné" value={filters.assignee} onChange={filter('assignee')}>
          <option value="">Tous les assignés</option>
          <option value="none">Non assignées</option>
          {members.map((member) => <option key={member._id} value={member._id}>{member.name}</option>)}
        </select>
        <select aria-label="Filtrer par priorité" value={filters.priority} onChange={filter('priority')}>
          <option value="">Toutes les priorités</option>
          {Object.entries(PRIORITIES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
        <select aria-label="Filtrer par étiquette" value={filters.label} onChange={filter('label')}>
          <option value="">Toutes les étiquettes</option>
          {labels.map((label) => <option key={label}>{label}</option>)}
        </select>
        <button
          type="button"
          className={mineOnly ? 'primary' : ''}
          aria-pressed={mineOnly}
          onClick={() => setFilters({ ...filters, assignee: mineOnly ? '' : user._id })}
        >
          Mes tâches
        </button>
        <button type="button" className="link" onClick={() => setFilters(NO_FILTER)}>Réinitialiser</button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={stopDrag}
      >
        <div className="board">
          {columns.map((column) => (
            <Column
              key={column.key}
              column={column}
              ids={layout[column.key] ?? []}
              onAdd={readOnly ? null : () => setCreatingIn(column.key)}
            >
              {(layout[column.key] ?? []).map((id) => {
                const task = tasksById.get(id);
                return task ? (
                  <TaskCard key={id} task={task} project={project} usersById={usersById} onOpen={openTask} disabled={readOnly} />
                ) : null;
              })}
            </Column>
          ))}
        </div>
        <DragOverlay>
          {activeId && (
            <article className="task-card overlay-card">
              <CardBody task={tasksById.get(activeId)} project={project} usersById={usersById} />
            </article>
          )}
        </DragOverlay>
      </DndContext>

      {creatingIn && (
        <NewTask
          project={project}
          members={members}
          status={creatingIn}
          onClose={() => setCreatingIn(null)}
          onCreated={() => {
            setCreatingIn(null);
            reload();
          }}
        />
      )}
      {openTaskId && (
        <TaskModal
          key={openTaskId}
          taskId={openTaskId}
          project={project}
          members={members}
          usersById={usersById}
          timeZone={company.timezone}
          onClose={() => openTask(null)}
          onChanged={reload}
        />
      )}
      {panel === 'activity' && (
        <ActivityPanel project={project} usersById={usersById} timeZone={company.timezone} onClose={() => setPanel(null)} />
      )}
      {panel === 'settings' && (
        <ProjectSettings project={project} tasks={tasks} users={users} onClose={() => setPanel(null)} onChanged={reload} />
      )}
    </div>
  );
}

function NewTask({ project, members, status, onClose, onCreated }) {
  const { attempt } = useFeedback();
  const [pending, setPending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    const ok = await attempt(
      () =>
        api(`/projects/${project._id}/tasks`, {
          method: 'POST',
          body: {
            status,
            title: form.get('title'),
            priority: form.get('priority'),
            assigneeId: form.get('assigneeId') || null,
            dueDate: form.get('dueDate') || null,
          },
        }),
      'Tâche créée',
    );
    setPending(false);
    if (ok) onCreated();
  };

  return (
    <Modal title="Nouvelle tâche" onClose={onClose} narrow>
      <form onSubmit={submit}>
        <Field label="Titre"><input name="title" required maxLength={200} autoFocus /></Field>
        <Field label="Priorité">
          <select name="priority" defaultValue="medium">
            {Object.entries(PRIORITIES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </Field>
        <Field label="Assigné">
          <select name="assigneeId" defaultValue="">
            <option value="">Personne</option>
            {members.map((member) => <option key={member._id} value={member._id}>{member.name}</option>)}
          </select>
        </Field>
        <Field label="Échéance"><input name="dueDate" type="date" /></Field>
        <div className="actions"><button className="primary" disabled={pending}>Créer</button></div>
      </form>
    </Modal>
  );
}

function ActivityPanel({ project, usersById, timeZone, onClose }) {
  const { data, error } = useLoad(() => api(`/projects/${project._id}/activity`), [project._id]);
  return (
    <Modal title="Activité du projet" onClose={onClose}>
      {!data && <Loading error={error} />}
      {data?.length === 0 && <p className="muted">Aucune activité.</p>}
      <ul className="activity">
        {data?.map((entry) => (
          <li key={entry._id}>
            <strong>{usersById.get(entry.actorId)?.name ?? 'Ancien utilisateur'}</strong>{' '}
            {describeActivity(entry, { project, usersById })}
            <small className="muted">{formatDateTime(entry.createdAt, timeZone)}</small>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
