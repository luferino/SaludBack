import express from 'express';
import pg from 'pg';
import config from './config.js';
import { createAuthRouter } from './modules/auth/infrastructure/routes/auth.routes.js';
import { PgUserRepository } from './modules/auth/infrastructure/repositories/pg-user-repository.js';
import { BcryptHasher } from './modules/auth/infrastructure/services/bcrypt-hasher.js';
import { JwtTokenService } from './modules/auth/infrastructure/services/jwt-token-service.js';
import { errorHandler } from './middleware/error-handler.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const repository = new PgUserRepository(pool);
const hasher = new BcryptHasher(config.bcryptCost);
const tokenService = new JwtTokenService({
  secret: config.jwtSecret,
  expiresIn: config.jwtExpiresIn,
});

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

app.use('/auth', createAuthRouter({ repository, hasher, tokenService }));

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});
