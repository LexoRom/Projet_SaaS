import { Router } from 'express';
import { z } from 'zod';
import { lockCompany } from '../access.js';
import { closeSession, requireRole } from '../auth.js';
import { withTx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { TENANT_COLLECTIONS } from '../scoped.js';
import { fields, parse, toId } from '../validation.js';
import { presentCompany } from './presenters.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json(presentCompany(await req.ctx.tenant.company.get()));
});

const isTimezone = (value) => {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const updateSchema = z.object({
  name: fields.name.optional(),
  color: fields.color.optional(),
  timezone: z.string().max(60).refine(isTimezone, 'fuseau horaire inconnu').optional(),
});

router.patch('/', requireRole('owner', 'admin'), async (req, res) => {
  const changes = parse(updateSchema, req.body);
  const company = await req.ctx.tenant.company.update({ $set: { ...changes, updatedAt: new Date() } });
  res.json(presentCompany(company));
});

router.post('/transfer', requireRole('owner'), async (req, res) => {
  const { userId } = parse(z.object({ userId: fields.id }), req.body);
  const { tenant, user } = req.ctx;
  const targetId = toId(userId);

  await withTx(async (session) => {
    const company = await lockCompany(tenant, session);
    // Revérifié sous verrou : deux transferts simultanés ne créent pas deux propriétaires.
    if (!company.ownerId.equals(user._id)) throw forbidden();
    const target = await tenant.users.findOne({ _id: targetId }, { session });
    if (!target) throw notFound('Utilisateur introuvable');
    if (target.role !== 'admin') throw badRequest('Le nouveau propriétaire doit être administrateur');
    const updatedAt = new Date();
    await tenant.users.updateOne({ _id: user._id }, { $set: { role: 'admin', updatedAt } }, { session });
    await tenant.users.updateOne({ _id: targetId }, { $set: { role: 'owner', updatedAt } }, { session });
    await tenant.company.update({ $set: { ownerId: targetId, updatedAt } }, { session });
  });

  res.status(204).end();
});

router.delete('/', requireRole('owner'), async (req, res) => {
  const { confirmName } = parse(z.object({ confirmName: z.string() }), req.body);
  const { tenant, user } = req.ctx;

  await withTx(async (session) => {
    const company = await lockCompany(tenant, session);
    if (!company.ownerId.equals(user._id)) throw forbidden();
    if (confirmName !== company.name) throw badRequest('Le nom saisi ne correspond pas au nom de l’entreprise');
    for (const name of TENANT_COLLECTIONS) {
      await tenant[name].deleteMany({}, { session });
    }
    await tenant.company.remove({ session });
  });

  closeSession(res);
  res.status(204).end();
});

export default router;
