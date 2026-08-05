import process from 'node:process';

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];

function missingRequired() {
  return REQUIRED_ENV.filter((name) => !process.env[name]);
}

// Load .env when the process was not started with --env-file
// (e.g. plain `node src/index.js`). Native Node, no dotenv.
if (missingRequired().length > 0) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file present; the validation below reports the missing variables.
  }
}

const missing = missingRequired();
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(', ')}. ` +
      'Copy .env.example to .env and fill in the values.',
  );
}

export const config = Object.freeze({
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '2h',
  bcryptCost: Number.parseInt(process.env.BCRYPT_COST ?? '12', 10),
});

export default config;
