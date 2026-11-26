import { useState } from 'react';
import { api } from '../api.js';
import { Field, formValues, useFeedback } from '../ui.jsx';

export default function AuthPage({ onSession }) {
  const [mode, setMode] = useState('login');
  const [pending, setPending] = useState(false);
  const { attempt } = useFeedback();
  const isRegister = mode === 'register';

  const submit = async (event) => {
    event.preventDefault();
    const body = formValues(event.currentTarget);
    setPending(true);
    await attempt(async () => onSession(await api(`/auth/${mode}`, { method: 'POST', body })));
    setPending(false);
  };

  return (
    <main className="center">
      <form className="card auth" onSubmit={submit} key={mode}>
        <h1>Regestion</h1>
        <p className="muted">{isRegister ? 'Créez l’espace de votre entreprise' : 'Connectez-vous à votre espace'}</p>
        {isRegister && (
          <>
            <Field label="Nom de l’entreprise"><input name="companyName" required maxLength={80} /></Field>
            <Field label="Votre nom"><input name="name" required maxLength={80} autoComplete="name" /></Field>
          </>
        )}
        <Field label="E-mail"><input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Mot de passe">
          <input
            name="password"
            type="password"
            required
            minLength={isRegister ? 8 : 1}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
          />
        </Field>
        <button className="primary" disabled={pending}>{isRegister ? 'Créer mon entreprise' : 'Se connecter'}</button>
        <button type="button" className="link" onClick={() => setMode(isRegister ? 'login' : 'register')}>
          {isRegister ? 'J’ai déjà un compte' : 'Inscrire mon entreprise'}
        </button>
      </form>
    </main>
  );
}
