import bcrypt from 'bcryptjs';
import { PasswordHasherPort } from '../../application/ports.js';

/**
 * bcryptjs implementation of the PasswordHasher port.
 * The cost factor is injected at wiring time from config, keeping the
 * service free of env access and trivially testable.
 */
export class BcryptHasher extends PasswordHasherPort {
  constructor(cost = 12) {
    super();
    this.cost = cost;
  }

  async hash(plain) {
    return bcrypt.hash(plain, this.cost);
  }

  async compare(plain, hash) {
    return bcrypt.compare(plain, hash);
  }
}
