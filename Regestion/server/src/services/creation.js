// Construction des documents, partagée par l'API et le seed.
import { ObjectId } from 'mongodb';
import { db } from '../db.js';
import { scoped } from '../scoped.js';

const AVATAR_COLORS = ['#f59e0b', '#2563eb', '#10b981', '#8b5cf6', '#ef4444', '#0891b2', '#db2777', '#65a30d'];

export const pickColor = (seed) => AVATAR_COLORS[[...seed].reduce((sum, c) => sum + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

export const DEFAULT_COLUMNS = [
  { key: 'todo', name: 'À faire', order: 0, isDone: false },
  { key: 'in_progress', name: 'En cours', order: 1, isDone: false },
  { key: 'review', name: 'En revue', order: 2, isDone: false },
  { key: 'done', name: 'Terminé', order: 3, isDone: true },
];

const slugify = (name) =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'entreprise';

export function buildCompany({ _id = new ObjectId(), name, ownerId, color = '#2563eb', timezone = 'Europe/Paris' }) {
  const now = new Date();
  return { _id, name, slug: slugify(name), color, timezone, ownerId, rev: 0, createdAt: now, updatedAt: now };
}

/** Crée l'identifiant de connexion puis le profil. À appeler dans une transaction. */
export async function insertUser(tenant, { _id = new ObjectId(), email, name, role, passwordHash }, session) {
  const now = new Date();
  // L'e-mail est l'_id du compte : un doublon fait échouer l'insertion (erreur 11000).
  await tenant.accounts.insertOne(
    { _id: email, userId: _id, passwordHash, lastLoginAt: null, createdAt: now },
    { session },
  );
  const user = {
    _id,
    companyId: tenant.companyId,
    email,
    name,
    role,
    avatarColor: pickColor(email),
    createdAt: now,
    updatedAt: now,
  };
  await tenant.users.insertOne(user, { session });
  return user;
}

export async function registerCompany({ companyName, name, email, passwordHash }, session) {
  const companyId = new ObjectId();
  const userId = new ObjectId();
  const tenant = scoped(db, companyId);
  const user = await insertUser(tenant, { _id: userId, email, name, role: 'owner', passwordHash }, session);
  const company = buildCompany({ _id: companyId, name: companyName, ownerId: userId });
  await db.collection('companies').insertOne(company, { session });
  return { company, user };
}
