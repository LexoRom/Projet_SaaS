import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { checkPassword, closeSession, hashPassword, openSession, requireAuth } from '../auth.js';
import { db, withTx } from '../db.js';
import { badRequest, conflict, unauthorized } from '../errors.js';
import { scoped } from '../scoped.js';
import { registerCompany } from '../services/creation.js';
import { changeEmail } from '../services/users.js';
import { fields, parse } from '../validation.js';
import { presentCompany, presentUser } from './presenters.js';

const router = Router();

// Ralentit les essais de mots de passe ; seuls les échecs sont comptés.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez dans quelques minutes' },
});

const registerSchema = z.object({
  companyName: fields.name,
  name: fields.name,
  email: fields.email,
  password: fields.password,
});

router.post('/register', limiter, async (req, res) => {
  const { password, ...input } = parse(registerSchema, req.body);
  const passwordHash = await hashPassword(password);
  let created;
  try {
    created = await withTx((session) => registerCompany({ ...input, passwordHash }, session));
  } catch (error) {
    if (error.code === 11000) throw conflict('Cette adresse e-mail est déjà utilisée');
    throw error;
  }
  openSession(res, { userId: created.user._id, companyId: created.company._id });
  res.status(201).json({ user: presentUser(created.user), company: presentCompany(created.company) });
});

const loginSchema = z.object({ email: fields.email, password: z.string().min(1).max(200) });

// Hachage factice : la réponse prend le même temps, que le compte existe ou non.
const dummyHash = hashPassword('compte-inexistant');

router.post('/login', limiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  // Seul accès non filtré par entreprise : la connexion cherche justement à la découvrir.
  const account = await db.collection('accounts').findOne({ _id: email });
  const valid = await checkPassword(password, account?.passwordHash ?? (await dummyHash));
  if (!account || !valid) throw unauthorized('E-mail ou mot de passe incorrect');

  const tenant = scoped(db, account.companyId);
  const [user, company] = await Promise.all([tenant.users.findOne({ _id: account.userId }), tenant.company.get()]);
  if (!user || !company) throw unauthorized('E-mail ou mot de passe incorrect');

  await tenant.accounts.updateOne({ _id: email }, { $set: { lastLoginAt: new Date() } });
  openSession(res, { userId: user._id, companyId: company._id });
  res.json({ user: presentUser(user), company: presentCompany(company) });
});

router.post('/logout', (req, res) => {
  closeSession(res);
  res.status(204).end();
});

router.get('/me', requireAuth, async (req, res) => {
  const company = await req.ctx.tenant.company.get();
  res.json({ user: presentUser(req.ctx.user), company: presentCompany(company) });
});

const profileSchema = z.object({
  name: fields.name.optional(),
  email: fields.email.optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: fields.password.optional(),
});

router.patch('/profile', requireAuth, limiter, async (req, res) => {
  const input = parse(profileSchema, req.body);
  const { tenant, user } = req.ctx;
  const emailChanges = input.email !== undefined && input.email !== user.email;

  if (emailChanges || input.newPassword) {
    const account = await tenant.accounts.findOne({ _id: user.email });
    if (!input.currentPassword || !(await checkPassword(input.currentPassword, account.passwordHash))) {
      throw badRequest('Le mot de passe actuel est incorrect');
    }
  }
  const passwordHash = input.newPassword ? await hashPassword(input.newPassword) : null;

  await withTx(async (session) => {
    if (emailChanges) await changeEmail(tenant, user._id, input.email, session);
    if (passwordHash) {
      await tenant.accounts.updateOne({ userId: user._id }, { $set: { passwordHash } }, { session });
    }
    if (input.name) {
      await tenant.users.updateOne({ _id: user._id }, { $set: { name: input.name, updatedAt: new Date() } }, { session });
    }
  });

  res.json({ user: presentUser(await tenant.users.findOne({ _id: user._id })) });
});

export default router;
