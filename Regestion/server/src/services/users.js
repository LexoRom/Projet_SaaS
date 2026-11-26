import { conflict, notFound } from '../errors.js';

/**
 * L'e-mail est l'_id du compte, et un _id est immuable : on insère le nouveau compte
 * puis on supprime l'ancien. À appeler dans une transaction.
 */
export async function changeEmail(tenant, userId, email, session) {
  const account = await tenant.accounts.findOne({ userId }, { session });
  if (!account) throw notFound('Utilisateur introuvable');
  if (account._id === email) return;
  try {
    await tenant.accounts.insertOne({ ...account, _id: email }, { session });
  } catch (error) {
    // Un conflit d'écriture transitoire doit remonter pour que la transaction soit relancée.
    if (error.code === 11000) throw conflict('Cette adresse e-mail est déjà utilisée');
    throw error;
  }
  await tenant.accounts.deleteOne({ _id: account._id }, { session });
  await tenant.users.updateOne({ _id: userId }, { $set: { email, updatedAt: new Date() } }, { session });
}
