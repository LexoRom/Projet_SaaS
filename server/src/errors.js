import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message) => new HttpError(400, message);
export const unauthorized = (message = 'Veuillez vous connecter') => new HttpError(401, message);
export const forbidden = (message = 'Action non autorisée') => new HttpError(403, message);
export const notFound = (message = 'Ressource introuvable') => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);

// Codes renvoyés par MongoDB quand aucun primaire n'est disponible (élection, arrêt d'un nœud).
const UNAVAILABLE_CODES = new Set([6, 7, 89, 91, 133, 189, 262, 9001, 10107, 11600, 11602, 13435, 13436]);
const UNAVAILABLE_NAMES = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongoNotConnectedError',
]);

function isDatabaseUnavailable(error) {
  return (
    UNAVAILABLE_NAMES.has(error?.name) ||
    UNAVAILABLE_CODES.has(error?.code) ||
    Boolean(error?.hasErrorLabel?.('RetryableWriteError')) ||
    Boolean(error?.hasErrorLabel?.('TransientTransactionError'))
  );
}

// eslint-disable-next-line no-unused-vars -- Express reconnaît le gestionnaire à ses 4 paramètres
export function errorHandler(error, req, res, next) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error instanceof z.ZodError) {
    const message = error.issues
      .map((issue) => (issue.path.length ? `${issue.path.join('.')} : ${issue.message}` : issue.message))
      .join(' ; ');
    return res.status(400).json({ error: message });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalide' });
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Requête trop volumineuse' });
  }
  if (error?.code === 11000) {
    return res.status(409).json({ error: 'Cette valeur est déjà utilisée' });
  }
  if (isDatabaseUnavailable(error)) {
    console.error('Base indisponible :', error.message);
    return res
      .status(503)
      .set('Retry-After', '5')
      .json({ error: 'Base de données momentanément indisponible, réessayez dans quelques secondes' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Erreur interne' });
}
