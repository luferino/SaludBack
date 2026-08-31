import type { Pool } from 'pg';
import type { Queryable, UnitOfWorkPort } from '../application/unit-of-work.js';

/**
 * PostgreSQL implementation of the UnitOfWork port. Borrows a client
 * from the pool, runs the work between BEGIN/COMMIT, and ROLLBACKs when
 * the work throws — releasing the client back to the pool in all cases.
 */
export class PgUnitOfWork implements UnitOfWorkPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async withTransaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Connection broken mid-transaction; nothing safe to roll back.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}