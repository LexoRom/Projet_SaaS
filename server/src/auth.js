import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { config } from './config.js';
import { db } from './db.js';
import { forbidden, unauthorized } from './errors.js';
import { scoped } from './scoped.js';

const COOKIE = 'taskflow_session';
const MAX_AGE_SECONDS = 8 * 60 * 60;

export const hashPassword = (password) => bcrypt.hash(password, 12);
export const checkPassword = (password, hash) => bcrypt.compare(password, hash);

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: config.cookieSecure,
  path: '/',
});

export function openSession(res, { userId, companyId }) {
  const token = jwt.sign({ sub: userId.toHexString(), cid: companyId.toHexString() }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: MAX_AGE_SECONDS,
  });
  res.cookie(COOKIE, token, { ...cookieOptions(), maxAge: MAX_AGE_SECONDS * 1000 });
}

export const closeSession = (res) => res.clearCookie(COOKIE, cookieOptions());

/**
 * Recharge l'utilisateur à chaque requête : un compte supprimé ou un rôle modifié
 * prend effet immédiatement. L'entreprise vient uniquement du jeton signé.
 */
export async function requireAuth(req, res, next) {
  let claims;
  try {
    claims = jwt.verify(req.cookies?.[COOKIE] ?? '', config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized();
  }
  const companyId = new ObjectId(claims.cid);
  const tenant = scoped(db, companyId);
  const user = await tenant.users.findOne({ _id: new ObjectId(claims.sub) });
  if (!user) {
    closeSession(res);
    throw unauthorized();
  }
  req.ctx = { user, companyId, tenant };
  next();
}

export const isManager = (user) => user.role === 'owner' || user.role === 'admin';

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.ctx.user.role)) throw forbidden();
    next();
  };
}
