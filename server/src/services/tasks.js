import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getTask, lockProject, logActivity } from '../access.js';
import { withTx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { fields, toId } from '../validation.js';

const STEP = 1024;
const MIN_GAP = 1e-6;

const taskFields = {
  title: fields.text(200),
  description: fields.text(10000, 0),
  status: fields.columnKey,
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  assigneeId: fields.id.nullable(),
  dueDate: z.iso.date('date au format AAAA-MM-JJ').nullable(),
  labels: z
    .array(fields.text(30))
    .max(10)
    .transform((labels) => [...new Set(labels)]),
  checklist: z
    .array(z.object({ id: z.string().min(1).max(40), text: fields.text(200), done: z.boolean() }))
    .max(50),
};

export const createTaskSchema = z.object({
  title: taskFields.title,
  description: taskFields.description.default(''),
  status: taskFields.status.optional(),
  priority: taskFields.priority.default('medium'),
  assigneeId: taskFields.assigneeId.default(null),
  dueDate: taskFields.dueDate.default(null),
  labels: taskFields.labels.default([]),
  checklist: taskFields.checklist.default([]),
});

export const updateTaskSchema = z.object(taskFields).partial();

const toDate = (value) => (value ? new Date(`${value}T00:00:00Z`) : null);

function assertColumn(project, status) {
  if (!project.columns.some((column) => column.key === status)) throw badRequest('Statut inconnu pour ce projet');
}

/** RG-05 : l'assigné est un membre du projet (donc de la même entreprise), ou personne. */
function resolveAssignee(project, assigneeId) {
  if (assigneeId === null) return null;
  const id = toId(assigneeId);
  if (!project.members.some((member) => member.userId.equals(id))) {
    throw notFound('Assigné introuvable parmi les membres du projet');
  }
  return id;
}

const isDoneColumn = (project, status) => project.columns.some((c) => c.key === status && c.isDone);

export async function nextPosition(tenant, projectId, status, session) {
  const [last] = await tenant.tasks.find({ projectId, status }, { session }).sort({ position: -1 }).limit(1).toArray();
  return last ? last.position + STEP : STEP;
}

export function createTask({ tenant, user }, projectId, input) {
  return withTx(async (session) => {
    // Incrément atomique du compteur : les numéros sont uniques et jamais réutilisés.
    const project = await lockProject(tenant, user, projectId, session, { inc: { taskCounter: 1 } });
    const status = input.status ?? [...project.columns].sort((a, b) => a.order - b.order)[0].key;
    assertColumn(project, status);
    const now = new Date();
    const task = {
      _id: new ObjectId(),
      companyId: tenant.companyId,
      projectId,
      number: project.taskCounter,
      title: input.title,
      description: input.description,
      status,
      position: await nextPosition(tenant, projectId, status, session),
      priority: input.priority,
      assigneeId: resolveAssignee(project, input.assigneeId),
      dueDate: toDate(input.dueDate),
      labels: input.labels,
      checklist: input.checklist,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
      completedAt: isDoneColumn(project, status) ? now : null,
    };
    await tenant.tasks.insertOne(task, { session });
    await logActivity(
      tenant,
      {
        projectId,
        taskId: task._id,
        actorId: user._id,
        type: 'task.created',
        data: { number: task.number, title: task.title },
      },
      session,
    );
    return task;
  });
}

/** Champs liés au statut : `completedAt` suit l'entrée et la sortie de la colonne « terminé ». */
function statusChanges(project, task, status) {
  const done = isDoneColumn(project, status);
  return { status, completedAt: done ? (task.completedAt ?? new Date()) : null };
}

/** Verrouille le projet de la tâche puis relit la tâche dans la transaction. */
export async function lockTask({ tenant, user }, taskId, session) {
  const found = await getTask(tenant, user, taskId, { session });
  const project = await lockProject(tenant, user, found.projectId, session);
  return { task: found, project };
}

export function updateTask(ctx, taskId, input) {
  const { tenant, user } = ctx;
  return withTx(async (session) => {
    const { task, project } = await lockTask(ctx, taskId, session);
    const { status, assigneeId, dueDate, ...simple } = input;
    const changes = { ...simple, updatedAt: new Date() };
    const base = { projectId: project._id, taskId, actorId: user._id };
    const label = { number: task.number, title: input.title ?? task.title };
    const events = [];

    if (status !== undefined && status !== task.status) {
      assertColumn(project, status);
      Object.assign(changes, statusChanges(project, task, status));
      changes.position = await nextPosition(tenant, project._id, status, session);
      events.push({ type: 'task.status_changed', data: { ...label, from: task.status, to: status } });
    }
    if (assigneeId !== undefined) {
      const next = resolveAssignee(project, assigneeId);
      if (String(next) !== String(task.assigneeId)) {
        changes.assigneeId = next;
        events.push({ type: 'task.assigned', data: { ...label, assigneeId: next } });
      }
    }
    if (dueDate !== undefined) changes.dueDate = toDate(dueDate);
    if (events.length === 0) events.push({ type: 'task.updated', data: label });

    await tenant.tasks.updateOne({ _id: taskId }, { $set: changes }, { session });
    for (const event of events) await logActivity(tenant, { ...base, ...event }, session);
    return tenant.tasks.findOne({ _id: taskId }, { session });
  });
}

/**
 * Déplace une carte juste après `afterId` dans la colonne `status` (en tête si `null`).
 * La nouvelle position est la moyenne des voisines : une seule carte est réécrite.
 */
export function moveTask(ctx, taskId, { status, afterId }) {
  const { tenant, user } = ctx;
  return withTx(async (session) => {
    const { task, project } = await lockTask(ctx, taskId, session);
    assertColumn(project, status);

    const others = await tenant.tasks
      .find({ projectId: project._id, status, _id: { $ne: taskId } }, { session })
      .sort({ position: 1 })
      .toArray();

    let index = 0;
    if (afterId) {
      const found = others.findIndex((other) => other._id.equals(toId(afterId)));
      index = found === -1 ? others.length : found + 1;
    }
    const before = others[index - 1];
    const after = others[index];

    let position;
    if (before && after) position = (before.position + after.position) / 2;
    else if (before) position = before.position + STEP;
    else if (after) position = after.position - STEP;
    else position = STEP;

    if (before && after && after.position - before.position < MIN_GAP) {
      // Plus assez d'écart entre les voisines : on renumérote la colonne.
      others.splice(index, 0, { _id: taskId });
      for (const [rank, other] of others.entries()) {
        const value = (rank + 1) * STEP;
        if (other._id.equals(taskId)) position = value;
        else await tenant.tasks.updateOne({ _id: other._id }, { $set: { position: value } }, { session });
      }
    }

    await tenant.tasks.updateOne(
      { _id: taskId },
      { $set: { ...statusChanges(project, task, status), position, updatedAt: new Date() } },
      { session },
    );
    if (status !== task.status) {
      await logActivity(
        tenant,
        {
          projectId: project._id,
          taskId,
          actorId: user._id,
          type: 'task.status_changed',
          data: { number: task.number, title: task.title, from: task.status, to: status },
        },
        session,
      );
    }
    return tenant.tasks.findOne({ _id: taskId }, { session });
  });
}
