import type { Career } from '../domain/career.entity.js';

export interface CareerRepositoryPort {
  list(): Promise<Career[]>;
}
