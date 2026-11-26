// Toute la configuration vient de l'environnement : aucune adresse de base n'est écrite dans le code.
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

const writeConcern = process.env.MONGO_WRITE_CONCERN || 'majority';

export const config = {
  mongoUri: required('MONGO_URI'),
  mongoDb: process.env.MONGO_DB || 'taskflow',
  writeConcern: /^\d+$/.test(writeConcern) ? Number(writeConcern) : writeConcern,
  port: Number(process.env.PORT || 8080),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  seedEnabled: process.env.SEED_ENABLED === 'true',
  get jwtSecret() {
    return required('JWT_SECRET');
  },
  get seedPassword() {
    return required('SEED_DEMO_PASSWORD');
  },
};
