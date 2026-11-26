import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../App.jsx';
import { describeActivity, formatDateTime, isManager, PRIORITIES } from '../format.js';
import { useLoad } from '../hooks.js';
import { Avatar, Field, Loading, Modal, useFeedback } from '../ui.jsx';

export default function TaskModal({ taskId, project, members, usersById, timeZone, onClose, onChanged }) {
  const { data, error, reload } = useLoad(() => api(`/tasks/${taskId}`), [taskId]);

  return (
    <Modal title={data ? `${project.key}-${data.task.number}` : 'Tâche'} onClose={onClose}>
      {!data ? (
        <Loading error={error} />
      ) : (
        <TaskDetails
          data={data}
          project={project}
          members={members}
          usersById={usersById}
          timeZone={timeZone}
          onClose={onClose}
          refresh={() => Promise.all([reload(), onChanged()])}
        />
      )}
    </Modal>
  );
}

function TaskDetails({ data, project, members, usersById, timeZone, onClose, refresh }) {
  const { task, comments, activity } = data;
  const { user } = useSession();
  const { attempt, confirm } = useFeedback();
  const readOnly = project.archived;
  const [checklist, setChecklist] = useState(task.checklist);
  const [newItem, setNewItem] = useState('');
  const [editing, setEditing] = useState(null);

  const patch = (body, message) =>
    attempt(async () => {
      await api(`/tasks/${task._id}`, { method: 'PATCH', body });
      await refresh();
    }, message);

  const save = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    patch(
      {
        title: form.get('title'),
        description: form.get('description'),
        status: form.get('status'),
        priority: form.get('priority'),
        assigneeId: form.get('assigneeId') || null,
        dueDate: form.get('dueDate') || null,
        labels: form.get('labels').split(',').map((label) => label.trim()).filter(Boolean),
      },
      'Tâche enregistrée',
    );
  };

  // La checklist est enregistrée dès qu'elle change.
  const saveChecklist = async (next) => {
    const previous = checklist;
    setChecklist(next);
    if (!(await patch({ checklist: next }))) setChecklist(previous);
  };

  const addItem = (event) => {
    event.preventDefault();
    if (!newItem.trim()) return;
    saveChecklist([...checklist, { id: crypto.randomUUID(), text: newItem.trim(), done: false }]);
    setNewItem('');
  };

  const remove = async () => {
    if (!(await confirm('Supprimer définitivement cette tâche et ses commentaires ?'))) return;
    if (
      await attempt(async () => {
        await api(`/tasks/${task._id}`, { method: 'DELETE' });
      }, 'Tâche supprimée')
    ) {
      onClose();
      // La tâche n'existe plus : seul le tableau est rechargé.
      refresh();
    }
  };

  const submitComment = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form).get('body');
    const ok = await attempt(async () => {
      await api(`/tasks/${task._id}/comments`, { method: 'POST', body: { body } });
      await refresh();
    });
    if (ok) form.reset();
  };

  const editComment = async (event) => {
    event.preventDefault();
    const body = new FormData(event.currentTarget).get('body');
    const ok = await attempt(async () => {
      await api(`/comments/${editing}`, { method: 'PATCH', body: { body } });
      await refresh();
    });
    if (ok) setEditing(null);
  };

  const deleteComment = async (id) => {
    if (!(await confirm('Supprimer ce commentaire ?'))) return;
    attempt(async () => {
      await api(`/comments/${id}`, { method: 'DELETE' });
      await refresh();
    });
  };

  const canDelete = !readOnly && (isManager(user) || task.createdBy === user._id);

  return (
    <div className="task-details">
      <form onSubmit={save}>
        <fieldset disabled={readOnly}>
          <Field label="Titre"><input name="title" defaultValue={task.title} required maxLength={200} /></Field>
          <Field label="Description">
            <textarea name="description" defaultValue={task.description} rows={4} maxLength={10000} />
          </Field>
          <div className="row">
            <Field label="Statut">
              <select name="status" defaultValue={task.status} key={task.status}>
                {[...project.columns].sort((a, b) => a.order - b.order).map((column) => (
                  <option key={column.key} value={column.key}>{column.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Assigné">
              <select name="assigneeId" defaultValue={task.assigneeId ?? ''}>
                <option value="">Personne</option>
                {members.map((member) => <option key={member._id} value={member._id}>{member.name}</option>)}
              </select>
            </Field>
            <Field label="Priorité">
              <select name="priority" defaultValue={task.priority}>
                {Object.entries(PRIORITIES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
              </select>
            </Field>
            <Field label="Échéance">
              <input name="dueDate" type="date" defaultValue={task.dueDate?.slice(0, 10) ?? ''} />
            </Field>
          </div>
          <Field label="Étiquettes (séparées par des virgules)">
            <input name="labels" defaultValue={task.labels.join(', ')} />
          </Field>
          {!readOnly && (
            <div className="actions">
              {canDelete && <button type="button" className="danger" onClick={remove}>Supprimer la tâche</button>}
              <span className="spacer" />
              <button className="primary">Enregistrer</button>
            </div>
          )}
        </fieldset>
      </form>

      <h3>Checklist</h3>
      <ul className="checklist">
        {checklist.map((item) => (
          <li key={item.id}>
            <label className="check">
              <input
                type="checkbox"
                checked={item.done}
                disabled={readOnly}
                onChange={() => saveChecklist(checklist.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))}
              />
              <span className={item.done ? 'struck' : ''}>{item.text}</span>
            </label>
            {!readOnly && (
              <button type="button" className="ghost" aria-label={`Retirer ${item.text}`} onClick={() => saveChecklist(checklist.filter((i) => i.id !== item.id))}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form className="inline" onSubmit={addItem}>
          <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Nouvel élément" maxLength={200} />
          <button>Ajouter</button>
        </form>
      )}

      <h3>Commentaires ({comments.length})</h3>
      <ul className="comments">
        {comments.map((comment) => {
          const author = usersById.get(comment.authorId);
          return (
            <li key={comment._id}>
              <Avatar user={author} />
              <div>
                <strong>{author?.name ?? 'Ancien utilisateur'}</strong>{' '}
                <small className="muted">
                  {formatDateTime(comment.createdAt, timeZone)}{comment.editedAt && ' · modifié'}
                </small>
                {editing === comment._id ? (
                  <form onSubmit={editComment}>
                    <textarea name="body" defaultValue={comment.body} required maxLength={5000} rows={3} autoFocus />
                    <div className="actions">
                      <button type="button" onClick={() => setEditing(null)}>Annuler</button>
                      <button className="primary">Enregistrer</button>
                    </div>
                  </form>
                ) : (
                  <p>{comment.body}</p>
                )}
                {!readOnly && comment.authorId === user._id && editing !== comment._id && (
                  <>
                    <button type="button" className="link" onClick={() => setEditing(comment._id)}>Modifier</button>
                    <button type="button" className="link" onClick={() => deleteComment(comment._id)}>Supprimer</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!readOnly && (
        <form onSubmit={submitComment}>
          <textarea name="body" placeholder="Écrire un commentaire" required maxLength={5000} rows={2} />
          <div className="actions"><button>Commenter</button></div>
        </form>
      )}

      <h3>Historique</h3>
      <ul className="activity">
        {activity.map((entry) => (
          <li key={entry._id}>
            <strong>{usersById.get(entry.actorId)?.name ?? 'Ancien utilisateur'}</strong>{' '}
            {describeActivity(entry, { project, usersById })}
            <small className="muted">{formatDateTime(entry.createdAt, timeZone)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
