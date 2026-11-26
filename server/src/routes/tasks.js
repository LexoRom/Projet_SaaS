import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getTask, logActivity } from '../access.js';
import { isManager } from '../auth.js';
import { withTx } from '../db.js';
import { forbidden, notFound } from '../errors.js';
import { lockTask, moveTask, updateTask, updateTaskSchema } from '../services/tasks.js';
import { fields, parse, toId } from '../validation.js';
import { presentDocument, presentTask } from './presenters.js';

export const taskRouter = Router();
export const commentRouter = Router();

taskRouter.get('/:id', async (req, res) => {
  const { tenant, user } = req.ctx;
  const taskId = toId(req.params.id);
  const task = await getTask(tenant, user, taskId);
  const [comments, activity] = await Promise.all([
    tenant.comments.find({ taskId }).sort({ createdAt: 1 }).toArray(),
    tenant.activities.find({ projectId: task.projectId, taskId }).sort({ createdAt: -1 }).limit(30).toArray(),
  ]);
  res.json({
    task: presentTask(task),
    comments: comments.map(presentDocument),
    activity: activity.map(presentDocument),
  });
});

taskRouter.patch('/:id', async (req, res) => {
  const input = parse(updateTaskSchema, req.body);
  res.json(presentTask(await updateTask(req.ctx, toId(req.params.id), input)));
});

const moveSchema = z.object({ status: fields.columnKey, afterId: fields.id.nullable().default(null) });

taskRouter.post('/:id/move', async (req, res) => {
  const input = parse(moveSchema, req.body);
  res.json(presentTask(await moveTask(req.ctx, toId(req.params.id), input)));
});

taskRouter.delete('/:id', async (req, res) => {
  const { tenant, user } = req.ctx;
  const taskId = toId(req.params.id);
  await withTx(async (session) => {
    const { task, project } = await lockTask(req.ctx, taskId, session);
    if (!isManager(user) && !task.createdBy.equals(user._id)) {
      throw forbidden('Seuls l’auteur de la tâche et les administrateurs peuvent la supprimer');
    }
    await tenant.comments.deleteMany({ taskId }, { session });
    await tenant.tasks.deleteOne({ _id: taskId }, { session });
    await logActivity(
      tenant,
      {
        projectId: project._id,
        taskId,
        actorId: user._id,
        type: 'task.deleted',
        data: { number: task.number, title: task.title },
      },
      session,
    );
  });
  res.status(204).end();
});

const commentSchema = z.object({ body: fields.text(5000) });

taskRouter.post('/:id/comments', async (req, res) => {
  const { body } = parse(commentSchema, req.body);
  const { tenant, user } = req.ctx;
  const taskId = toId(req.params.id);
  const comment = await withTx(async (session) => {
    const { task, project } = await lockTask(req.ctx, taskId, session);
    const document = {
      _id: new ObjectId(),
      companyId: tenant.companyId,
      projectId: project._id,
      taskId,
      authorId: user._id,
      body,
      createdAt: new Date(),
      editedAt: null,
    };
    await tenant.comments.insertOne(document, { session });
    await logActivity(
      tenant,
      {
        projectId: project._id,
        taskId,
        actorId: user._id,
        type: 'comment.created',
        data: { number: task.number, title: task.title },
      },
      session,
    );
    return document;
  });
  res.status(201).json(presentDocument(comment));
});

/** Seul l'auteur modifie ou supprime son commentaire, et seulement s'il voit encore le projet. */
async function lockOwnComment(req, commentId, session) {
  const { tenant, user } = req.ctx;
  const comment = await tenant.comments.findOne({ _id: commentId }, { session });
  if (!comment) throw notFound('Commentaire introuvable');
  await lockTask(req.ctx, comment.taskId, session);
  if (!comment.authorId.equals(user._id)) throw forbidden('Seul l’auteur peut modifier ce commentaire');
  return comment;
}

commentRouter.patch('/:id', async (req, res) => {
  const { body } = parse(commentSchema, req.body);
  const commentId = toId(req.params.id);
  const updated = await withTx(async (session) => {
    await lockOwnComment(req, commentId, session);
    return req.ctx.tenant.comments.findOneAndUpdate(
      { _id: commentId },
      { $set: { body, editedAt: new Date() } },
      { session, returnDocument: 'after' },
    );
  });
  res.json(presentDocument(updated));
});

commentRouter.delete('/:id', async (req, res) => {
  const commentId = toId(req.params.id);
  await withTx(async (session) => {
    await lockOwnComment(req, commentId, session);
    await req.ctx.tenant.comments.deleteOne({ _id: commentId }, { session });
  });
  res.status(204).end();
});
