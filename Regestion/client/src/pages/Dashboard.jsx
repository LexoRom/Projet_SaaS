import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatDay, isOverdue, PRIORITIES } from '../format.js';
import { useLoad } from '../hooks.js';
import { Loading } from '../ui.jsx';

export default function Dashboard() {
  const { data, error } = useLoad(() => api('/dashboard'), []);
  if (!data) return <Loading error={error} />;

  const projectsById = new Map(data.projects.map((project) => [project._id, project]));

  const taskList = (tasks, empty) =>
    tasks.length === 0 ? (
      <p className="muted">{empty}</p>
    ) : (
      <ul className="tasks">
        {tasks.map((task) => {
          const project = projectsById.get(task.projectId);
          return (
            <li key={task._id}>
              <Link to={`/projets/${task.projectId}?tache=${task._id}`}>
                <code>{project.key}-{task.number}</code>
                <span>{task.title}</span>
                <span className={`badge ${task.priority}`}>{PRIORITIES[task.priority]}</span>
                {task.dueDate && <span className={isOverdue(task) ? 'late' : 'muted'}>{formatDay(task.dueDate)}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    );

  return (
    <>
      <h1>Tableau de bord</h1>
      <section className="card">
        <h2>Mes tâches ouvertes ({data.myTasks.length})</h2>
        {taskList(data.myTasks, 'Aucune tâche ouverte ne vous est assignée.')}
      </section>
      <section className="card">
        <h2>Tâches en retard ({data.overdue.length})</h2>
        {taskList(data.overdue, 'Aucune tâche en retard.')}
      </section>
      <section className="card">
        <h2>Répartition par statut</h2>
        {data.projects.length === 0 && <p className="muted">Aucun projet pour le moment.</p>}
        {data.projects.map((project) => {
          const total = Object.values(project.counts).reduce((sum, count) => sum + count, 0);
          return (
            <div className="stats" key={project._id}>
              <Link to={`/projets/${project._id}`}>
                <span className="dot" style={{ background: project.color }} />
                {project.name}
              </Link>
              <span className="muted">{total} tâche{total > 1 ? 's' : ''}</span>
              <div className="counts">
                {[...project.columns].sort((a, b) => a.order - b.order).map((column) => (
                  <span key={column.key} className={column.isDone ? 'count done' : 'count'}>
                    {column.name} <strong>{project.counts[column.key] ?? 0}</strong>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
