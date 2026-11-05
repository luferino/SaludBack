import type { Group } from '../domain/group.entity.js';

export interface GroupRepositoryPort {
  create(group: Group): Promise<Group>;
  list(options: { careerId?: string; limit: number; offset: number }): Promise<Group[]>;
}
