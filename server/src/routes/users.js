import { Router } from 'express';
import { z } from 'zod';
import { lockCompany } from '../access.js';
import { hashPassword, requireRole } from '../auth.js';
import { withTx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { insertUser } from '../services/creation.js';
import { changeEmail } from '../services/users.js';
import { escapeRegex, fields, parse, toId } from '../validation.js';
import { presentUser } from './presenters.js';

const router = Router();
const managers = requireRole('owner', 'admin');
const assignableRole = z.enum(['admin', 'member']);

// Tous les membres de l'entreprise peuvent consulter l'annuaire.
router.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const filter = q
    ? { $or: [{ name: { $regex: escapeRegex(q), $options: 'i' } }, { email: { $regex: escapeRegex(q), $options: 'i' } }] }
    : {};
  const users = await req.ctx.tenant.users.find(filter).sort({ name: 1 }).toArray();
  res.json(users.map(presentUser));
});

const createSchema = z.object({
  name: fields.name,
  email: fields.email,
  role: assignableRole,
  password: fields.password,
});

router.post('/', managers, async (req, res) => {
  const { password, ...input } = parse(createSchema, req.body);
  const { tenant } = req.ctx;
  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await withTx(async (session) => {
      await lockCompany(tenant, session);
      return insertUser(tenant, { ...input, passwordHash }, session);
    });
  } catch (error) {
    if (error.code === 11000) throw conflict('Cette adresse e-mail est déjà utilisée');
    throw error;
  }
  res.status(201).json(presentUser(user));
});

const updateSchema = z.object({
  name: fields.name.optional(),
  email: fields.email.optional(),
  role: assignableRole.optional(),
});

/** Charge la cible sous verrou et applique les règles qui protègent le propriétaire. */
async function lockTarget(req, targetId, session) {
  const { tenant, user } = req.ctx;
  await lockCompany(tenant, session);
  const target = await tenant.users.findOne({ _id: targetId }, { session });
  if (!target) throw notFound('Utilisateur introuvable');
  if (target.role === 'owner' && !target._id.equals(user._id)) {
    throw forbidden('Seul le propriétaire peut modifier son compte');
  }
  return target;
}

router.patch('/:id', managers, async (req, res) => {
  const input = parse(updateSchema, req.body);
  const { tenant } = req.ctx;
  const targetId = toId(req.params.id);

  await withTx(async (session) => {
    const target = await lockTarget(req, targetId, session);
    if (target.role === 'owner' && input.role) {
      throw badRequest('Le rôle du propriétaire change uniquement par un transfert de propriété');
    }
    if (input.email) await changeEmail(tenant, targetId, input.email, session);
    const changes = { updatedAt: new Date() };
    if (input.name) changes.name = input.name;
    if (input.role) changes.role = input.role;
    await tenant.users.updateOne({ _id: targetId }, { $set: changes }, { session });
  });

  res.json(presentUser(await tenant.users.findOne({ _id: targetId })));
});

router.delete('/:id', managers, async (req, res) => {
  const { tenant, user } = req.ctx;
  const targetId = toId(req.params.id);

  await withTx(async (session) => {
    const target = await lockTarget(req, targetId, session);
    if (target.role === 'owner') throw badRequest('Le propriétaire ne peut pas être supprimé');
    if (target._id.equals(user._id)) throw badRequest('Vous ne pouvez pas supprimer votre propre compte');

    const now = new Date();
    await tenant.users.deleteOne({ _id: targetId }, { session });
    await tenant.accounts.deleteOne({ userId: targetId }, { session });
    // `rev` verrouille aussi chaque projet concerné contre une assignation simultanée.
    await tenant.projects.updateMany(
      { 'members.userId': targetId },
      { $pull: { members: { userId: targetId } }, $inc: { rev: 1 }, $set: { updatedAt: now } },
      { session },
    );
    await tenant.tasks.updateMany(
      { assigneeId: targetId },
      { $set: { assigneeId: null, updatedAt: now } },
      { session },
    );
  });

  res.status(204).end();
});

export default router;
