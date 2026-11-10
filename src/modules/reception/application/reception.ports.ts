import type { User } from '../../auth/domain/user.entity.js';

export interface ReceptionAccessRepository {
  createAccount(user: User): Promise<User>;
  searchAccounts(input: ReceptionAccountSearch): Promise<ReceptionAccountSummary[]>;
  listGrants(userId: string, activeOnly?: boolean): Promise<ReceptionCareerGrant[]>;
  grantCareer(userId: string, careerCode: string, actorId: string): Promise<ReceptionCareerGrant>;
  revokeGrant(grantId: string, actorId: string): Promise<ReceptionCareerGrant>;
  withActiveCareerScope<T>(userId: string, careerCode: string, work: (client: import('../../shared/application/unit-of-work.js').Queryable) => Promise<T>): Promise<T>;
}

export interface ReceptionAccountSearch {
  q?: string;
  career?: string;
  limit: number;
  offset: number;
}

export interface ReceptionAccountSummary {
  id: string;
  username: string;
  email: string | null;
  active_careers: string[];
}

export interface ReceptionCareerGrant {
  id: string;
  userId: string;
  careerCode: string;
  grantedBy: string;
  grantedAt: Date | string;
  revokedBy: string | null;
  revokedAt: Date | string | null;
}
