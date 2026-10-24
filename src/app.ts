import express from 'express';
import type { Pool } from 'pg';
import { createDependencies } from './bootstrap/create-dependencies.js';
import { mountAuthRoutes } from './bootstrap/routes/auth.routes.js';
import { mountProfileRoutes } from './bootstrap/routes/profiles.routes.js';
import { mountAcademicRoutes, mountTeacherHabilitationRoutes } from './bootstrap/routes/academic.routes.js';
import { mountClinicalRoutes } from './bootstrap/routes/clinical.routes.js';
import { errorHandler } from './middleware/error-handler.js';

/** Composition root: one app-local object graph, explicit mounts, global middleware. */
export function createApp(pool: Pool): express.Express {
  const dependencies = createDependencies(pool);
  const app = express();

  app.use(express.json());
  app.get('/', (_req, res) => {
    res.send('Hello, World!');
  });

  mountAuthRoutes(app, dependencies.auth);
  mountProfileRoutes(app, dependencies.profiles);
  mountAcademicRoutes(app, dependencies.academic);
  mountClinicalRoutes(app, dependencies.clinical);
  mountTeacherHabilitationRoutes(app, dependencies.academic);

  app.use(errorHandler);
  return app;
}
