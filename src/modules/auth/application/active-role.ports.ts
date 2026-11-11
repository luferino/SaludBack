/** Audited, deliberately narrow membership administration for the extra Reception role. */
export interface UserRoleGrant {
  id: string;
  userId: string;
  role: 'reception';
  grantedBy: string;
  grantedAt: Date | string;
  revokedBy: string | null;
  revokedAt: Date | string | null;
}

export interface StudentRoleCandidate {
  id: string;
  username: string;
  email: string | null;
}

export interface LiveRoleReader {
  isValidActiveRole(userId: string, role: string, grantId?: string): Promise<boolean>;
}

export interface RoleGrantRepository extends LiveRoleReader {
  searchStudentCandidates(input: { q: string; limit: number; offset: number }): Promise<StudentRoleCandidate[]>;
  listReceptionRoleGrants(userId: string): Promise<UserRoleGrant[]>;
  grantReceptionRole(userId: string, actorId: string): Promise<UserRoleGrant>;
  revokeReceptionRoleGrant(grantId: string, actorId: string): Promise<UserRoleGrant>;
  /** Live grant lookup for a later authentication unit; this T2.A route does not use it. */
  hasActiveReceptionRoleGrant(userId: string, grantId?: string): Promise<boolean>;
  availableRoles(userId: string): Promise<string[]>;
  activeReceptionRoleGrant(userId: string): Promise<UserRoleGrant | null>;
  isValidActiveRole(userId: string, role: string, grantId?: string): Promise<boolean>;
}
