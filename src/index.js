import express from 'express';
import pg from 'pg';
import config from './config.js';
import { createAuthRouter } from './modules/auth/infrastructure/routes/auth.routes.js';
import { PgUserRepository } from './modules/auth/infrastructure/repositories/pg-user-repository.js';
import { BcryptHasher } from './modules/auth/infrastructure/services/bcrypt-hasher.js';
import { JwtTokenService } from './modules/auth/infrastructure/services/jwt-token-service.js';
import { createPatientRouter } from './modules/pacientes/infrastructure/routes/patient.routes.js';
import { PgPatientRepository } from './modules/pacientes/infrastructure/repositories/pg-patient-repository.js';
import { errorHandler } from './middleware/error-handler.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const repository = new PgUserRepository(pool);
const patientRepository = new PgPatientRepository(pool);
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

// Open route: no guard or actor hook passed, so alta is public and
// created_by stays null until a pacientes:write guard and token wiring land.
app.use('/patients', createPatientRouter({ repository: patientRepository }));

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});
