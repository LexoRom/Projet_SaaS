import { MongoClient } from 'mongodb';
import { config } from './config.js';

export let client;
export let db;

export async function connect() {
  client = new MongoClient(config.mongoUri, {
    appName: 'taskflow',
    writeConcern: { w: config.writeConcern },
  });
  await client.connect();
  db = client.db(config.mongoDb);
  return db;
}

/**
 * Exécute `fn(session)` dans une transaction. Le driver relance automatiquement la
 * fonction après une erreur transitoire (conflit d'écriture, élection d'un primaire).
 * Les opérations de `fn` doivent toutes recevoir `session` et s'exécuter en séquence.
 */
export async function withTx(fn) {
  const session = client.startSession();
  try {
    return await session.withTransaction(() => fn(session), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: config.writeConcern },
    });
  } finally {
    await session.endSession();
  }
}
