import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const FeedbackContext = createContext(null);
export const useFeedback = () => useContext(FeedbackContext);

/** Notifications et demandes de confirmation, communes à toute l'application. */
export function FeedbackProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [question, setQuestion] = useState(null);
  const timer = useRef(null);

  const notify = useCallback((message, kind = 'info') => {
    clearTimeout(timer.current);
    setToast({ message, kind });
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  /** Exécute une action et affiche son erreur ; renvoie `true` en cas de succès. */
  const attempt = useCallback(
    async (action, success) => {
      try {
        await action();
        if (success) notify(success);
        return true;
      } catch (error) {
        notify(error.message, 'error');
        return false;
      }
    },
    [notify],
  );

  const confirm = useCallback((message) => new Promise((resolve) => setQuestion({ message, resolve })), []);

  const answer = (value) => {
    question.resolve(value);
    setQuestion(null);
  };

  const value = useMemo(() => ({ notify, attempt, confirm }), [notify, attempt, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {question && (
        <Modal title="Confirmation" onClose={() => answer(false)} narrow>
          <p>{question.message}</p>
          <div className="actions">
            <button type="button" onClick={() => answer(false)}>
              Annuler
            </button>
            <button type="button" className="danger" onClick={() => answer(true)}>
              Confirmer
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.message}
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function Modal({ title, onClose, children, narrow }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={narrow ? 'modal narrow' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ user }) {
  if (!user) return <span className="avatar empty" title="Non assignée">?</span>;
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className="avatar" style={{ background: user.avatarColor }} title={user.name}>
      {initials}
    </span>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Loading({ error }) {
  return error ? <p className="error">{error.message}</p> : <p className="muted">Chargement…</p>;
}

/** Lit les champs nommés d'un formulaire sans état React intermédiaire. */
export const formValues = (form) => Object.fromEntries(new FormData(form));
