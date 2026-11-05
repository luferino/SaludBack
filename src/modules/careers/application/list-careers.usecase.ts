import type { Career } from '../domain/career.entity.js';
import type { CareerRepositoryPort } from './career.ports.js';

export interface ListCareersResult {
  items: Career[];
}

export class ListCareers {
  private readonly repository: CareerRepositoryPort;

  constructor({ repository }: { repository: CareerRepositoryPort }) {
    this.repository = repository;
  }

  async execute(): Promise<ListCareersResult> {
    const items = await this.repository.list();
    return { items };
  }
}
