import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../App.jsx';
import { isManager, ROLES } from '../format.js';
import { useLoad } from '../hooks.js';
import { Avatar, Field, formValues, Loading, Modal, useFeedback } from '../ui.jsx';

export default function Users() {
  const { user: me, setSession } = useSession();
  const [search, setSearch] = useState('');
  // null : fermé ; {} : création ; utilisateur : modification.
  const [edited, setEdited] = useState(null);
  const { data, error, reload } = useLoad(() => api(`/users?q=${encodeURIComponent(search)}`), [search]);
  const { attempt, confirm } = useFeedback();
  const manager = isManager(me);
  const creating = edited && !edited._id;

  const submit = async (event) => {
    event.preventDefault();
    const body = formValues(event.currentTarget);
    const ok = await attempt(
      async () => {
        await api(creating ? '/users' : `/users/${edited._id}`, { method: creating ? 'POST' : 'PATCH', body });
        if (edited._id === me._id) setSession(await api('/auth/me'));
        await reload();
      },
      creating ? 'Utilisateur créé' : 'Utilisateur modifié',
    );
    if (ok) setEdited(null);
  };

  const remove = async (target) => {
    if (!(await confirm(`Supprimer définitivement ${target.name} ? Ses tâches deviendront non assignées.`))) return;
    attempt(async () => {
      await api(`/users/${target._id}`, { method: 'DELETE' });
      await reload();
    }, 'Utilisateur supprimé');
  };

  const canEdit = (target) => manager && (target.role !== 'owner' || target._id === me._id);
  const canDelete = (target) => manager && target.role !== 'owner' && target._id !== me._id;

  return (
    <>
      <div className="toolbar">
        <h1>Utilisateurs</h1>
        <input type="search" placeholder="Nom ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} />
        {manager && <button type="button" className="primary" onClick={() => setEdited({})}>Nouvel utilisateur</button>}
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="card table-wrapper">
          <table>
            <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th /></tr></thead>
            <tbody>
              {data.map((target) => (
                <tr key={target._id}>
                  <td><Avatar user={target} /> {target.name}</td>
                  <td>{target.email}</td>
                  <td>{ROLES[target.role]}</td>
                  <td>
                    {canEdit(target) && <button type="button" className="link" onClick={() => setEdited(target)}>Modifier</button>}
                    {canDelete(target) && <button type="button" className="link" onClick={() => remove(target)}>Supprimer</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edited && (
        <Modal title={creating ? 'Nouvel utilisateur' : `Modifier ${edited.name}`} onClose={() => setEdited(null)} narrow>
          <form onSubmit={submit}>
            <Field label="Nom"><input name="name" defaultValue={edited.name} required maxLength={80} autoFocus /></Field>
            {/* Le propriétaire change son propre e-mail depuis son profil, avec son mot de passe. */}
            {edited._id !== me._id && (
              <Field label="E-mail"><input name="email" type="email" defaultValue={edited.email} required /></Field>
            )}
            {edited.role !== 'owner' && edited._id !== me._id && (
              <Field label="Rôle">
                <select name="role" defaultValue={edited.role ?? 'member'}>
                  <option value="member">{ROLES.member}</option>
                  <option value="admin">{ROLES.admin}</option>
                </select>
              </Field>
            )}
            {creating && (
              <Field label="Mot de passe initial (8 caractères minimum)">
                <input name="password" type="password" required minLength={8} autoComplete="new-password" />
              </Field>
            )}
            <div className="actions"><button className="primary">{creating ? 'Créer' : 'Enregistrer'}</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
