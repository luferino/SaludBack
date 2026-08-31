import bcrypt from 'bcryptjs';
import type { PasswordHasherPort } from '../../application/auth.ports.js';

/**
 * bcryptjs implementation of the PasswordHasher port.
 * The cost factor is injected at wiring time from config, keeping the
 * service free of env access and trivially testable.
 */
export class BcryptHasher implements PasswordHasherPort {
  private readonly cost: number;

  constructor(cost = 12) {
    this.cost = cost;
  }

  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  async compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
