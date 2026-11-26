// Droits d'accès aux projets, et verrous logiques utilisés dans les transactions.
//
// Une transaction MongoDB isole les lectures (snapshot) mais n'empêche pas deux transactions
// de lire la même situation puis d'écrire des documents différents. En écrivant d'abord dans
// un document parent commun (`$inc: { rev: 1 }`), on provoque un conflit d'écriture : l'une des
// deux est relancée et voit alors le résultat de l'autre.
import { isManager } from './auth.js';
import { conflict, notFound } from './errors.js';

/** Un membre ne voit que ses projets ; owner et admin voient tous ceux de leur entreprise. */
export const visibleProjects = (user) => (isManager(user) ? {} : { 'members.userId': user._id });

export async function getProject(tenant, user, projectId, options) {
  const project = await tenant.projects.findOne({ ...visibleProjects(user), _id: projectId }, options);
  if (!project) throw notFound('Projet introuvable');
  return project;
}

/**
 * Verrouille l'entreprise : sérialise les opérations sur les utilisateurs, les membres,
 * les clés de projet et le transfert de propriété.
 */
export async function lockCompany(tenant, session) {
  const company = await tenant.company.update({ $inc: { rev: 1 } }, { session });
  if (!company) throw notFound('Entreprise introuvable');
  return company;
}

/** Verrouille un projet : sérialise les écritures sur ses tâches, commentaires et colonnes. */
export async function lockProject(tenant, user, projectId, session, { allowArchived = false, inc = {} } = {}) {
  const project = await tenant.projects.findOneAndUpdate(
    { ...visibleProjects(user), _id: projectId },
    { $inc: { rev: 1, ...inc } },
    { session, returnDocument: 'after' },
  );
  if (!project) throw notFound('Projet introuvable');
  // L'exception annule la transaction, y compris les incréments ci-dessus.
  if (project.archived && !allowArchived) throw conflict('Ce projet est archivé : il est en lecture seule');
  return project;
}

/** Retrouve une tâche d'un projet visible par l'utilisateur. */
export async function getTask(tenant, user, taskId, options) {
  const task = await tenant.tasks.findOne({ _id: taskId }, options);
  if (!task) throw notFound('Tâche introuvable');
  const visible = await tenant.projects.findOne(
    { ...visibleProjects(user), _id: task.projectId },
    { ...options, projection: { _id: 1 } },
  );
  if (!visible) throw notFound('Tâche introuvable');
  return task;
}

export const logActivity = (tenant, entry, session) =>
  tenant.activities.insertOne({ taskId: null, data: {}, ...entry, createdAt: new Date() }, { session });
