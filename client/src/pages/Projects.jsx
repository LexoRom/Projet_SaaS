import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../App.jsx';
import { isManager } from '../format.js';
import { useLoad } from '../hooks.js';
import { Field, formValues, Loading, Modal, useFeedback } from '../ui.jsx';

export default function Projects() {
  const { user } = useSession();
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data, error } = useLoad(() => api(`/projects?archived=${archived}`), [archived]);
  const { attempt } = useFeedback();
  const navigate = useNavigate();

  const create = (event) => {
    event.preventDefault();
    const body = formValues(event.currentTarget);
    attempt(async () => {
      const project = await api('/projects', { method: 'POST', body });
      navigate(`/projets/${project._id}`);
    }, 'Projet créé');
  };

  return (
    <>
      <div className="toolbar">
        <h1>Projets</h1>
        <label className="check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archivés
        </label>
        {isManager(user) && (
          <button type="button" className="primary" onClick={() => setCreating(true)}>Nouveau projet</button>
        )}
      </div>

      {!data && <Loading error={error} />}
      {data?.length === 0 && <p className="muted">{archived ? 'Aucun projet archivé.' : 'Aucun projet pour le moment.'}</p>}
      <div className="grid">
        {data?.map((project) => (
          <Link className="card project" key={project._id} to={`/projets/${project._id}`} style={{ borderTopColor: project.color }}>
            <h2>{project.name} <code>{project.key}</code></h2>
            <p className="muted">{project.description || 'Sans description'}</p>
            <small>{project.members.length} membre{project.members.length > 1 ? 's' : ''}</small>
          </Link>
        ))}
      </div>

      {creating && (
        <Modal title="Nouveau projet" onClose={() => setCreating(false)} narrow>
          <form onSubmit={create}>
            <Field label="Nom"><input name="name" required maxLength={80} autoFocus /></Field>
            <Field label="Clé (2 à 6 lettres)">
              <input name="key" required pattern="[A-Za-z]{2,6}" maxLength={6} />
            </Field>
            <Field label="Description"><textarea name="description" maxLength={2000} rows={3} /></Field>
            <Field label="Couleur"><input name="color" type="color" defaultValue="#10b981" /></Field>
            <div className="actions"><button className="primary">Créer</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
