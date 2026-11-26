import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth.js';
import { db } from './db.js';
import { errorHandler, HttpError, notFound } from './errors.js';
import authRoutes from './routes/auth.js';
import companyRoutes from './routes/company.js';
import dashboardRoutes from './routes/dashboard.js';
import projectRoutes from './routes/projects.js';
import { commentRouter, taskRouter } from './routes/tasks.js';
import userRoutes from './routes/users.js';

const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      // L'application est servie en HTTP en local : pas de passage forcé en HTTPS.
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
      strictTransportSecurity: false,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (req, res) => {
    // Délai propre au contrôle : le driver, lui, attend un serveur jusqu'à 30 s.
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), 3000);
    });
    try {
      await Promise.race([db.command({ ping: 1 }), timeout]);
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'database unavailable' });
    } finally {
      clearTimeout(timer);
    }
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Les écritures n'acceptent que du JSON, ce qu'un formulaire d'un autre site ne peut pas envoyer.
    const hasBody = Number(req.headers['content-length'] || 0) > 0;
    if (hasBody && !req.is('application/json')) throw new HttpError(415, 'Le corps doit être en JSON');
    next();
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/company', requireAuth, companyRoutes);
  app.use('/api/users', requireAuth, userRoutes);
  app.use('/api/projects', requireAuth, projectRoutes);
  app.use('/api/tasks', requireAuth, taskRouter);
  app.use('/api/comments', requireAuth, commentRouter);
  app.use('/api/dashboard', requireAuth, dashboardRoutes);
  app.use('/api', () => {
    throw notFound('Route inconnue');
  });

  if (existsSync(publicDirectory)) {
    app.use(express.static(publicDirectory));
    // Application monopage : les autres adresses renvoient index.html.
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(publicDirectory, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
