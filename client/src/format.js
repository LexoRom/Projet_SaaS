export const PRIORITIES = { low: 'Basse', medium: 'Moyenne', high: 'Haute', urgent: 'Urgente' };
export const ROLES = { owner: 'Propriétaire', admin: 'Administrateur', member: 'Membre' };

export const isManager = (user) => user.role === 'owner' || user.role === 'admin';

// Les échéances sont des jours entiers stockés à minuit UTC.
export const formatDay = (value) =>
  new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const formatDateTime = (value, timeZone) =>
  new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone });

export function isOverdue(task) {
  if (!task.dueDate || task.completedAt) return false;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(task.dueDate).getTime() < today;
}

export function describeActivity(activity, { project, usersById }) {
  const { type, data } = activity;
  const column = (key) => project.columns.find((c) => c.key === key)?.name ?? 'colonne supprimée';
  const task = data.number ? `${project.key}-${data.number}` : 'une tâche';
  switch (type) {
    case 'task.created':
      return `a créé ${task}`;
    case 'task.updated':
      return `a modifié ${task}`;
    case 'task.status_changed':
      return `a déplacé ${task} de « ${column(data.from)} » vers « ${column(data.to)} »`;
    case 'task.assigned':
      return data.assigneeId
        ? `a assigné ${task} à ${usersById.get(data.assigneeId)?.name ?? 'un ancien utilisateur'}`
        : `a désassigné ${task}`;
    case 'task.deleted':
      return `a supprimé ${task} « ${data.title} »`;
    case 'comment.created':
      return `a commenté ${task}`;
    case 'project.member_added':
      return `a ajouté ${data.name} au projet`;
    case 'project.member_removed':
      return `a retiré ${data.name} du projet`;
    default:
      return type;
  }
}
