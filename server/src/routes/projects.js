import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getProject, lockCompany, lockProject, logActivity, visibleProjects } from '../access.js';
import { requireRole } from '../auth.js';
import { withTx } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { DEFAULT_COLUMNS } from '../services/creation.js';
import { createTask, createTaskSchema, nextPosition } from '../services/tasks.js';
import { fields, parse, toId } from '../validation.js';
import { presentDocument, presentProject, presentTask } from './presenters.js';

const router = Router();
const managers = requireRole('owner', 'admin');

router.get('/', async (req, res) => {
  const { tenant, user } = req.ctx;
  const archived = req.query.archived === 'true';
  const projects = await tenant.projects.find({ ...visibleProjects(user), archived }).sort({ name: 1 }).toArray();
  res.json(projects.map(presentProject));
});

const createSchema = z.object({
  name: fields.name,
  key: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, 'la clé contient 2 à 6 lettres'),
  description: fields.text(2000, 0).default(''),
  color: fields.color.default('#10b981'),
});

router.post('/', managers, async (req, res) => {
  const input = parse(createSchema, req.body);
  const { tenant, user } = req.ctx;

  const project = await withTx(async (session) => {
    // Le verrou de l'entreprise rend fiable la vérification d'unicité de la clé (RG-09).
    await lockCompany(tenant, session);
    if (await tenant.projects.findOne({ key: input.key }, { session })) {
      throw conflict(`La clé ${input.key} est déjà utilisée par un autre projet`);
    }
    const now = new Date();
    const document = {
      _id: new ObjectId(),
      companyId: tenant.companyId,
      ...input,
      archived: false,
      members: [{ userId: user._id, addedAt: now }],
      columns: DEFAULT_COLUMNS,
      taskCounter: 0,
      rev: 0,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    };
    await tenant.projects.insertOne(document, { session });
    return document;
  });

  res.status(201).json(presentProject(project));
});

router.get('/:id', async (req, res) => {
  const { tenant, user } = req.ctx;
  res.json(presentProject(await getProject(tenant, user, toId(req.params.id))));
});

const updateSchema = z.object({
  name: fields.name.optional(),
  description: fields.text(2000, 0).optional(),
  color: fields.color.optional(),
  archived: z.boolean().optional(),
});

router.patch('/:id', managers, async (req, res) => {
  const changes = parse(updateSchema, req.body);
  const { tenant, user } = req.ctx;
  const projectId = toId(req.params.id);

  await withTx(async (session) => {
    const project = await lockProject(tenant, user, projectId, session, { allowArchived: true });
    // Un projet archivé est en lecture seule : seule sa restauration est acceptée (RG-10).
    if (project.archived && !(changes.archived === false && Object.keys(changes).length === 1)) {
      throw conflict('Restaurez le projet avant de le modifier');
    }
    await tenant.projects.updateOne({ _id: projectId }, { $set: { ...changes, updatedAt: new Date() } }, { session });
  });

  res.json(presentProject(await getProject(tenant, user, projectId)));
});

router.delete('/:id', managers, async (req, res) => {
  const { tenant, user } = req.ctx;
  const projectId = toId(req.params.id);

  await withTx(async (session) => {
    await lockProject(tenant, user, projectId, session, { allowArchived: true });
    await tenant.tasks.deleteMany({ projectId }, { session });
    await tenant.comments.deleteMany({ projectId }, { session });
    await tenant.activities.deleteMany({ projectId }, { session });
    await tenant.projects.deleteOne({ _id: projectId }, { session });
  });

  res.status(204).end();
});

router.post('/:id/members', managers, async (req, res) => {
  const { userId } = parse(z.object({ userId: fields.id }), req.body);
  const { tenant, user } = req.ctx;
  const projectId = toId(req.params.id);
  const memberId = toId(userId);

  await withTx(async (session) => {
    await lockCompany(tenant, session);
    const project = await lockProject(tenant, user, projectId, session);
    // La recherche est limitée à l'entreprise : un utilisateur d'une autre est « introuvable ».
    const member = await tenant.users.findOne({ _id: memberId }, { session });
    if (!member) throw notFound('Utilisateur introuvable');
    if (project.members.some((m) => m.userId.equals(memberId))) throw conflict('Cet utilisateur est déjà membre');
    await tenant.projects.updateOne(
      { _id: projectId },
      { $push: { members: { userId: memberId, addedAt: new Date() } }, $set: { updatedAt: new Date() } },
      { session },
    );
    await logActivity(
      tenant,
      { projectId, actorId: user._id, type: 'project.member_added', data: { name: member.name } },
      session,
    );
  });

  res.status(201).json(presentProject(await getProject(tenant, user, projectId)));
});

router.delete('/:id/members/:userId', managers, async (req, res) => {
  const { tenant, user } = req.ctx;
  const projectId = toId(req.params.id);
  const memberId = toId(req.params.userId);

  await withTx(async (session) => {
    const project = await lockProject(tenant, user, projectId, session);
    if (!project.members.some((m) => m.userId.equals(memberId))) throw notFound('Membre introuvable');
    const now = new Date();
    await tenant.projects.updateOne(
      { _id: projectId },
      { $pull: { members: { userId: memberId } }, $set: { updatedAt: now } },
      { session },
    );
    await tenant.tasks.updateMany(
      { projectId, assigneeId: memberId },
      { $set: { assigneeId: null, updatedAt: now } },
      { session },
    );
    const member = await tenant.users.findOne({ _id: memberId }, { session });
    await logActivity(
      tenant,
      { projectId, actorId: user._id, type: 'project.member_removed', data: { name: member?.name ?? '' } },
      session,
    );
  });

  res.status(204).end();
});

const columnsSchema = z.object({
  columns: z
    .array(z.object({ key: fields.columnKey.optional(), name: fields.text(40), isDone: z.boolean() }))
    .min(2, 'au moins deux colonnes')
    .max(10),
  // Colonne supprimée -> colonne qui reçoit ses tâches (RG-07).
  moves: z.record(z.string(), fields.columnKey).default({}),
});

router.put('/:id/columns', managers, async (req, res) => {
  const input = parse(columnsSchema, req.body);
  const { tenant, user } = req.ctx;
  const projectId = toId(req.params.id);

  if (input.columns.filter((column) => column.isDone).length !== 1) {
    throw badRequest('Désignez exactement une colonne « terminé »');
  }

  await withTx(async (session) => {
    const project = await lockProject(tenant, user, projectId, session);
    const existing = new Set(project.columns.map((column) => column.key));
    const kept = new Set();
    const columns = input.columns.map((column, order) => {
      if (column.key !== undefined) {
        if (!existing.has(column.key) || kept.has(column.key)) throw badRequest('Colonne inconnue ou en double');
        kept.add(column.key);
      }
      return {
        key: column.key ?? `col_${randomBytes(4).toString('hex')}`,
        name: column.name,
        order,
        isDone: column.isDone,
      };
    });
    const newKeys = new Set(columns.map((column) => column.key));

    for (const removed of [...existing].filter((key) => !kept.has(key))) {
      const tasks = await tenant.tasks.find({ projectId, status: removed }, { session }).sort({ position: 1 }).toArray();
      if (tasks.length === 0) continue;
      const destination = input.moves[removed];
      if (!destination || !newKeys.has(destination)) {
        throw conflict('Cette colonne contient des tâches : choisissez une colonne de destination');
      }
      let position = await nextPosition(tenant, projectId, destination, session);
      for (const task of tasks) {
        await tenant.tasks.updateOne(
          { _id: task._id },
          { $set: { status: destination, position, updatedAt: new Date() } },
          { session },
        );
        position += 1024;
      }
    }

    const doneKey = columns.find((column) => column.isDone).key;
    await tenant.tasks.updateMany(
      { projectId, status: doneKey, completedAt: null },
      { $set: { completedAt: new Date() } },
      { session },
    );
    await tenant.tasks.updateMany(
      { projectId, status: { $ne: doneKey }, completedAt: { $ne: null } },
      { $set: { completedAt: null } },
      { session },
    );
    await tenant.projects.updateOne({ _id: projectId }, { $set: { columns, updatedAt: new Date() } }, { session });
  });

  res.json(presentProject(await getProject(tenant, user, projectId)));
});

router.get('/:id/tasks', async (req, res) => {
  const { tenant, user } = req.ctx;
  const projectId = toId(req.params.id);
  await getProject(tenant, user, projectId);
  const tasks = await tenant.tasks.find({ projectId }).sort({ status: 1, position: 1 }).toArray();
  res.json(tasks.map(presentTask));
});

router.post('/:id/tasks', async (req, res) => {
  const input = parse(createTaskSchema, req.body);
  const task = await createTask(req.ctx, toId(req.params.id), input);
  res.status(201).json(presentTask(task));
});

router.get('/:id/activity', async (req, res) => {
  const { tenant, user } = req.ctx;
  const projectId = toId(req.params.id);
  await getProject(tenant, user, projectId);
  const activities = await tenant.activities.find({ projectId }).sort({ createdAt: -1 }).limit(50).toArray();
  res.json(activities.map(presentDocument));
});

export default router;
