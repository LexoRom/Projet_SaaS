import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { notFound } from './errors.js';

z.config(z.locales.fr());

const text = (max, min = 1) => z.string().trim().min(min).max(max);

export const fields = {
  name: text(80),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  // bcrypt ignore tout ce qui dépasse 72 octets : on refuse plutôt que de tronquer.
  password: z
    .string()
    .min(8, 'au moins 8 caractères')
    .refine((value) => Buffer.byteLength(value) <= 72, '72 octets au maximum'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'couleur au format #rrggbb'),
  id: z.string().regex(/^[0-9a-f]{24}$/i, 'identifiant invalide'),
  columnKey: z.string().regex(/^[a-z0-9_]{1,30}$/),
  text,
};

export const parse = (schema, value) => schema.parse(value ?? {});

/** Un identifiant mal formé se comporte comme une ressource inexistante. */
export function toId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{24}$/i.test(value)) throw notFound();
  return new ObjectId(value);
}

export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
