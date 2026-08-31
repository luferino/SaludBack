import { createHash } from 'node:crypto';
import { BadRequestError } from '../../shared/domain/errors.js';
import type { UserRepositoryPort, ResetTokenRepositoryPort, PasswordHasherPort } from './auth.ports.js';

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

export interface ResetPasswordOutput {
  message: string;
}

/**
 * Reset Password use case.
 * The token is looked up by its sha256 hash; unknown, expired, and used
 * tokens all collapse into one generic 400 (design D5). On success the
 * token is marked used BEFORE the password hash is replaced (D8):
 * single-use is the security property, so a crash in between forces a
 * re-request instead of allowing token replay. Ports (repository,
 * resetTokenRepository, hasher) are injected.
 */
export class ResetPassword {
  private readonly repository: UserRepositoryPort;
  private readonly resetTokenRepository: ResetTokenRepositoryPort;
  private readonly hasher: PasswordHasherPort;

  constructor({
    repository,
    resetTokenRepository,
    hasher,
  }: {
    repository: UserRepositoryPort;
    resetTokenRepository: ResetTokenRepositoryPort;
    hasher: PasswordHasherPort;
  }) {
    this.repository = repository;
    this.resetTokenRepository = resetTokenRepository;
    this.hasher = hasher;
  }

  async execute({ token, newPassword }: ResetPasswordInput): Promise<ResetPasswordOutput> {
    if (!token || token.trim() === '') {
      throw new BadRequestError('token is required');
    }
    if (!newPassword) {
      throw new BadRequestError('newPassword is required');
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const resetToken = await this.resetTokenRepository.findValidByHash(tokenHash);
    if (!resetToken) {
      throw new BadRequestError('Invalid or expired reset token');
    }

    const newPasswordHash = await this.hasher.hash(newPassword);
    await this.resetTokenRepository.markUsed(resetToken.id!);
    await this.repository.updatePassword(resetToken.userId, newPasswordHash);

    return { message: 'Password has been reset' };
  }
}
