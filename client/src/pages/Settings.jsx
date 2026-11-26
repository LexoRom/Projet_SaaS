import { api } from '../api.js';
import { useSession } from '../App.jsx';
import { isManager } from '../format.js';
import { useLoad } from '../hooks.js';
import { Field, formValues, useFeedback } from '../ui.jsx';

const TIMEZONES = ['Europe/Paris', 'Europe/London', 'America/New_York', 'America/Montreal', 'Africa/Casablanca', 'Asia/Tokyo', 'UTC'];

export default function Settings() {
  const { user, company, setSession } = useSession();
  const { attempt, confirm } = useFeedback();
  const manager = isManager(user);
  const { data: users } = useLoad(() => api('/users'), [user.role]);
  const admins = users?.filter((u) => u.role === 'admin') ?? [];
  const timezones = TIMEZONES.includes(company.timezone) ? TIMEZONES : [company.timezone, ...TIMEZONES];

  const refreshSession = async () => setSession(await api('/auth/me'));

  const saveProfile = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(Object.entries(formValues(form)).filter(([, value]) => value !== ''));
    const ok = await attempt(async () => {
      await api('/auth/profile', { method: 'PATCH', body });
      await refreshSession();
    }, 'Profil enregistré');
    if (ok) {
      form.elements.currentPassword.value = '';
      form.elements.newPassword.value = '';
    }
  };

  const saveCompany = (event) => {
    event.preventDefault();
    const body = formValues(event.currentTarget);
    attempt(async () => {
      await api('/company', { method: 'PATCH', body });
      await refreshSession();
    }, 'Entreprise enregistrée');
  };

  const transfer = async (event) => {
    event.preventDefault();
    const body = formValues(event.currentTarget);
    if (!(await confirm('Transférer la propriété ? Vous deviendrez administrateur.'))) return;
    attempt(async () => {
      await api('/company/transfer', { method: 'POST', body });
      await refreshSession();
    }, 'Propriété transférée');
  };

  const deleteCompany = async (event) => {
    event.preventDefault();
    const body = formValues(event.currentTarget);
    if (!(await confirm('Supprimer définitivement l’entreprise et toutes ses données ?'))) return;
    attempt(async () => {
      await api('/company', { method: 'DELETE', body });
      setSession(null);
    }, 'Entreprise supprimée');
  };

  return (
    <>
      <h1>Paramètres</h1>

      <form className="card" onSubmit={saveProfile}>
        <h2>Mon profil</h2>
        <Field label="Nom"><input name="name" defaultValue={user.name} required maxLength={80} /></Field>
        <Field label="E-mail"><input name="email" type="email" defaultValue={user.email} required /></Field>
        <Field label="Mot de passe actuel (pour changer l’e-mail ou le mot de passe)">
          <input name="currentPassword" type="password" autoComplete="current-password" />
        </Field>
        <Field label="Nouveau mot de passe (facultatif)">
          <input name="newPassword" type="password" minLength={8} autoComplete="new-password" />
        </Field>
        <div className="actions"><button className="primary">Enregistrer</button></div>
      </form>

      {manager && (
        <form className="card" onSubmit={saveCompany} key={company.name + company.color + company.timezone}>
          <h2>Entreprise</h2>
          <Field label="Nom"><input name="name" defaultValue={company.name} required maxLength={80} /></Field>
          <Field label="Couleur"><input name="color" type="color" defaultValue={company.color} /></Field>
          <Field label="Fuseau horaire">
            <select name="timezone" defaultValue={company.timezone}>
              {timezones.map((zone) => <option key={zone}>{zone}</option>)}
            </select>
          </Field>
          <div className="actions"><button className="primary">Enregistrer</button></div>
        </form>
      )}

      {user.role === 'owner' && (
        <>
          <form className="card" onSubmit={transfer}>
            <h2>Transférer la propriété</h2>
            {admins.length === 0 ? (
              <p className="muted">Nommez d’abord un administrateur.</p>
            ) : (
              <div className="inline">
                <select name="userId" aria-label="Nouveau propriétaire">
                  {admins.map((admin) => <option key={admin._id} value={admin._id}>{admin.name}</option>)}
                </select>
                <button>Transférer</button>
              </div>
            )}
          </form>
          <form className="card danger-zone" onSubmit={deleteCompany}>
            <h2>Supprimer l’entreprise</h2>
            <p>Les utilisateurs, projets, tâches et commentaires seront supprimés définitivement.</p>
            <Field label={`Retapez « ${company.name} » pour confirmer`}>
              <input name="confirmName" required autoComplete="off" />
            </Field>
            <div className="actions"><button className="danger">Supprimer l’entreprise</button></div>
          </form>
        </>
      )}
    </>
  );
}
