import express from 'express';
import pg from 'pg';
import config from './config.js';
import { createAuthRouter } from './modules/auth/infrastructure/routes/auth.routes.js';
import { PgUserRepository } from './modules/auth/infrastructure/repositories/pg-user-repository.js';
import { BcryptHasher } from './modules/auth/infrastructure/services/bcrypt-hasher.js';
import { errorHandler } from './middleware/error-handler.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const repository = new PgUserRepository(pool);
const hasher = new BcryptHasher(config.bcryptCost);

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

app.use('/auth', createAuthRouter({ repository, hasher }));

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});
