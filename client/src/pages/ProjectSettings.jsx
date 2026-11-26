import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Avatar, Field, formValues, Modal, useFeedback } from '../ui.jsx';

export default function ProjectSettings({ project, tasks, users, onClose, onChanged }) {
  const { attempt, confirm } = useFeedback();
  const navigate = useNavigate();
  const readOnly = project.archived;

  const run = (action, message) =>
    attempt(async () => {
      await action();
      await onChanged();
    }, message);

  const base = `/projects/${project._id}`;

  const save = (event) => {
    event.preventDefault();
    const body = formValues(event.currentTarget);
    run(() => api(base, { method: 'PATCH', body }), 'Projet enregistré');
  };

  const remove = async () => {
    if (!(await confirm(`Supprimer définitivement « ${project.name} » avec ses tâches, commentaires et historique ?`))) return;
    if (await attempt(() => api(base, { method: 'DELETE' }), 'Projet supprimé')) navigate('/projets');
  };

  const memberIds = new Set(project.members.map((member) => member.userId));
  const candidates = users.filter((user) => !memberIds.has(user._id));

  const addMember = (event) => {
    event.preventDefault();
    const body = formValues(event.currentTarget);
    if (body.userId) run(() => api(`${base}/members`, { method: 'POST', body }), 'Membre ajouté');
  };

  const removeMember = async (member) => {
    if (!(await confirm(`Retirer ${member.name} du projet ? Ses tâches seront désassignées.`))) return;
    run(() => api(`${base}/members/${member._id}`, { method: 'DELETE' }), 'Membre retiré');
  };

  return (
    <Modal title="Gérer le projet" onClose={onClose}>
      <form onSubmit={save}>
        <fieldset disabled={readOnly}>
          <Field label="Nom"><input name="name" defaultValue={project.name} required maxLength={80} /></Field>
          <Field label="Description">
            <textarea name="description" defaultValue={project.description} maxLength={2000} rows={2} />
          </Field>
          <Field label="Couleur"><input name="color" type="color" defaultValue={project.color} /></Field>
          <div className="actions"><button className="primary">Enregistrer</button></div>
        </fieldset>
      </form>

      <h3>Membres</h3>
      <ul className="members">
        {project.members.map(({ userId }) => {
          const member = users.find((user) => user._id === userId);
          if (!member) return null;
          return (
            <li key={userId}>
              <Avatar user={member} />
              <span>{member.name}</span>
              {!readOnly && <button type="button" className="link" onClick={() => removeMember(member)}>Retirer</button>}
            </li>
          );
        })}
      </ul>
      {!readOnly && candidates.length > 0 && (
        <form className="inline" onSubmit={addMember}>
          <select name="userId" aria-label="Utilisateur à ajouter">
            {candidates.map((user) => <option key={user._id} value={user._id}>{user.name}</option>)}
          </select>
          <button>Ajouter au projet</button>
        </form>
      )}

      {!readOnly && (
        <ColumnsEditor
          key={JSON.stringify(project.columns)}
          project={project}
          tasks={tasks}
          onSave={(body) => run(() => api(`${base}/columns`, { method: 'PUT', body }), 'Colonnes enregistrées')}
        />
      )}

      <h3>Zone sensible</h3>
      <div className="actions">
        <button type="button" onClick={() => run(() => api(base, { method: 'PATCH', body: { archived: !readOnly } }), readOnly ? 'Projet restauré' : 'Projet archivé')}>
          {readOnly ? 'Restaurer le projet' : 'Archiver le projet'}
        </button>
        <button type="button" className="danger" onClick={remove}>Supprimer le projet</button>
      </div>
    </Modal>
  );
}

function ColumnsEditor({ project, tasks, onSave }) {
  const [columns, setColumns] = useState(() =>
    [...project.columns]
      .sort((a, b) => a.order - b.order)
      .map(({ key, name, isDone }) => ({ id: key, key, name, isDone })),
  );
  const [moves, setMoves] = useState({});

  const update = (id, changes) => setColumns(columns.map((c) => (c.id === id ? { ...c, ...changes } : c)));
  const shift = (index, offset) => {
    const next = [...columns];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setColumns(next);
  };

  const kept = new Set(columns.map((c) => c.key).filter(Boolean));
  const orphaned = project.columns.filter((c) => !kept.has(c.key) && tasks.some((t) => t.status === c.key));
  const destinations = columns.filter((c) => c.key);

  const submit = (event) => {
    event.preventDefault();
    onSave({
      columns: columns.map(({ key, name, isDone }) => ({ key, name, isDone })),
      moves: Object.fromEntries(orphaned.map((c) => [c.key, moves[c.key] ?? destinations[0]?.key]).filter(([, to]) => to)),
    });
  };

  return (
    <form onSubmit={submit}>
      <h3>Colonnes du Kanban</h3>
      <ul className="columns-editor">
        {columns.map((column, index) => (
          <li key={column.id}>
            <input
              aria-label={`Nom de la colonne ${index + 1}`}
              value={column.name}
              required
              maxLength={40}
              onChange={(e) => update(column.id, { name: e.target.value })}
            />
            <label className="check">
              <input
                type="radio"
                name="done"
                checked={column.isDone}
                onChange={() => setColumns(columns.map((c) => ({ ...c, isDone: c.id === column.id })))}
              />
              Terminé
            </label>
            <button type="button" className="ghost" disabled={index === 0} onClick={() => shift(index, -1)} aria-label="Monter">↑</button>
            <button type="button" className="ghost" disabled={index === columns.length - 1} onClick={() => shift(index, 1)} aria-label="Descendre">↓</button>
            <button
              type="button"
              className="ghost"
              disabled={columns.length <= 2 || column.isDone}
              onClick={() => setColumns(columns.filter((c) => c.id !== column.id))}
              aria-label={`Supprimer la colonne ${column.name}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {orphaned.map((column) => (
        <Field key={column.key} label={`Déplacer les tâches de « ${column.name} » vers`}>
          <select value={moves[column.key] ?? destinations[0]?.key} onChange={(e) => setMoves({ ...moves, [column.key]: e.target.value })}>
            {destinations.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
        </Field>
      ))}
      <div className="actions">
        <button
          type="button"
          disabled={columns.length >= 10}
          onClick={() => setColumns([...columns, { id: crypto.randomUUID(), name: 'Nouvelle colonne', isDone: false }])}
        >
          Ajouter une colonne
        </button>
        <button className="primary">Enregistrer les colonnes</button>
      </div>
    </form>
  );
}
