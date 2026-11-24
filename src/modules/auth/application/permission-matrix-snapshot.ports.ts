export interface PermissionMatrixSnapshot {
  permissions: Array<{ permission: string; enforced: boolean }>;
  roles: Array<{ role: string; permissions: string[] }>;
}

export interface PermissionMatrixSnapshotReader {
  readSnapshot(): Promise<PermissionMatrixSnapshot>;
}
