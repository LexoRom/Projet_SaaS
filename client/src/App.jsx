import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api.js';
import { ROLES } from './format.js';
import { Avatar, Loading, useFeedback } from './ui.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Board from './pages/Board.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Projects from './pages/Projects.jsx';
import Settings from './pages/Settings.jsx';
import Users from './pages/Users.jsx';

const SessionContext = createContext(null);
export const useSession = () => useContext(SessionContext);

export default function App() {
  // undefined : vérification en cours ; null : déconnecté.
  const [session, setSession] = useState(undefined);
  const [error, setError] = useState(null);
  const { attempt } = useFeedback();
  const navigate = useNavigate();

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null));
    api('/auth/me')
      .then(setSession)
      .catch((cause) => (cause.status === 401 ? setSession(null) : setError(cause)));
  }, []);

  if (session === undefined) return <main className="center"><Loading error={error} /></main>;

  if (session === null) {
    return (
      <AuthPage
        onSession={(next) => {
          navigate('/');
          setSession(next);
        }}
      />
    );
  }

  const logout = () =>
    attempt(async () => {
      await api('/auth/logout', { method: 'POST' });
      setSession(null);
    });

  return (
    <SessionContext.Provider value={{ ...session, setSession }}>
      <div className="layout">
        <aside style={{ borderTopColor: session.company.color }}>
          <div className="brand">
            <strong>Regestion</strong>
            <span>{session.company.name}</span>
          </div>
          <nav>
            <NavLink to="/" end>Tableau de bord</NavLink>
            <NavLink to="/projets">Projets</NavLink>
            <NavLink to="/utilisateurs">Utilisateurs</NavLink>
            <NavLink to="/parametres">Paramètres</NavLink>
          </nav>
          <div className="me">
            <Avatar user={session.user} />
            <div>
              <strong>{session.user.name}</strong>
              <span>{ROLES[session.user.role]}</span>
            </div>
            <button type="button" onClick={logout}>Se déconnecter</button>
          </div>
        </aside>
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projets" element={<Projects />} />
            <Route path="/projets/:projectId" element={<Board />} />
            <Route path="/utilisateurs" element={<Users />} />
            <Route path="/parametres" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </SessionContext.Provider>
  );
}
