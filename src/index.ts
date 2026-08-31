import pg from 'pg';
import config from './config.js';
import { createApp } from './app.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const app = createApp(pool);

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});
