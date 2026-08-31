/**
 * Shared transaction scaffolding. A `Queryable` is any database handle
 * that can run a parameterized query — a pg Pool, a pg PoolClient, or a
 * fake in tests. Repositories that participate in a unit of work accept
 * an optional client and route their writes through it; without one they
 * fall back to the injected pool.
 */
export interface Queryable {
  query<R = unknown>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/**
 * Port for atomic multi-write flows (alta en uno): `withTransaction`
 * runs `fn` inside one transaction and commits when it resolves or
 * rolls back when it throws, so the user account and the profile row
 * persist together or not at all.
 */
export interface UnitOfWorkPort {
  withTransaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T>;
}