import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { sql } from 'drizzle-orm';
import { config } from './config.js';
import { db } from './db/client.js';
import { errorHandler, ok, requestId } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { apiRouter } from './routes/api.js';
import { adminRouter } from './routes/admin.js';
import { webhookRouter } from './routes/webhooks.js';
import { publicRouter } from './routes/public.js';

export function createApp() {
  const c = config();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', c.NODE_ENV === 'production' ? 1 : false);
  app.use(requestId);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: c.APP_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-CSRF-Token'] }));

  // Raw-body webhooks must be mounted before the JSON parser.
  app.use('/api/webhooks', webhookRouter);

  app.use(express.json({ limit: '512kb' }));
  app.use(cookieParser());

  app.get('/healthz', async (req, res) => {
    await db.execute(sql`SELECT 1`);
    ok(req, res, { status: 'ok' });
  });
  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/v1', apiRouter);
  app.use('/api/app', dashboardRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_req, res) => { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }); });

  const webDist = path.resolve(process.cwd(), 'dist/web');
  // Serve the built dashboard whenever a build exists — both for production
  // deployments and for single-process local runs of the compiled app.
  if (existsSync(path.join(webDist, 'index.html'))) {
    app.set('trust proxy', true);
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/|\/healthz).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
