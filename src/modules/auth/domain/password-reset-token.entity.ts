/**
 * Password reset token. Plain entity with no dependencies so it stays
 * trivially testable. The raw token is never stored — only its sha256
 * hash (design D3); `usedAt` marks a token consumed by a reset or
 * invalidated by the per-user outstanding cap (design D4).
 */
export class PasswordResetToken {
  id: string | null;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date | string | null;

  constructor({
    id = null,
    userId,
    tokenHash,
    expiresAt,
    usedAt = null,
    createdAt = null,
  }: {
    id?: string | null;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt?: Date | null;
    createdAt?: Date | string | null;
  } = {} as {
    id?: string | null;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt?: Date | null;
    createdAt?: Date | string | null;
  }) {
    this.id = id;
    this.userId = userId;
    this.tokenHash = tokenHash;
    this.expiresAt = expiresAt;
    this.usedAt = usedAt;
    this.createdAt = createdAt;
  }

  /** Builds a new (not yet persisted) reset token. */
  static create({
    userId,
    tokenHash,
    expiresAt,
  }: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): PasswordResetToken {
    return new PasswordResetToken({ userId, tokenHash, expiresAt });
  }
}
