import type { Pool } from 'pg';
import { Career } from '../../domain/career.entity.js';
import type { CareerRepositoryPort } from '../../application/career.ports.js';

interface CareerRow {
  id: string;
  code: string;
  name: string;
}

export class PgCareerRepository implements CareerRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async list(): Promise<Career[]> {
    const { rows } = await this.pool.query<CareerRow>(
      'SELECT id, code, name FROM careers ORDER BY name ASC, id ASC',
    );
    return rows.map(rowToCareer);
  }
}

function rowToCareer(row: CareerRow): Career {
  return new Career({
    id: row.id,
    code: row.code,
    name: row.name,
  });
}
