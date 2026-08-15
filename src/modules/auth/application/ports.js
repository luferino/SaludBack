/**
 * Ports for the auth module. Use cases depend on these interfaces only;
 * infrastructure implementations (pg, bcryptjs, jsonwebtoken) are
 * injected at wiring time, keeping the dependency direction
 * domain <- application <- infrastructure.
 */

export class UserRepositoryPort {
  /**
   * @param {string} username
   * @returns {Promise<import('../domain/user.js').User|null>}
   */
  async findByUsername(_username) {
    throw new Error('UserRepositoryPort#findByUsername is not implemented');
  }

  /**
   * @param {import('../domain/user.js').User} user
   * @returns {Promise<import('../domain/user.js').User>} the persisted user
   */
  async create(_user) {
    throw new Error('UserRepositoryPort#create is not implemented');
  }

  /**
   * @param {string} email
   * @returns {Promise<import('../domain/user.js').User|null>}
   */
  async findByEmail(_email) {
    throw new Error('UserRepositoryPort#findByEmail is not implemented');
  }

  /**
   * Replaces the stored password hash so the previous password stops
   * working immediately.
   * @param {string} userId
   * @param {string} newPasswordHash
   * @returns {Promise<void>}
   */
  async updatePassword(_userId, _newPasswordHash) {
    throw new Error('UserRepositoryPort#updatePassword is not implemented');
  }
}

export class PasswordHasherPort {
  /**
   * @param {string} plain
   * @returns {Promise<string>} bcrypt hash
   */
  async hash(_plain) {
    throw new Error('PasswordHasherPort#hash is not implemented');
  }

  /**
   * @param {string} plain
   * @param {string} hash
   * @returns {Promise<boolean>}
   */
  async compare(_plain, _hash) {
    throw new Error('PasswordHasherPort#compare is not implemented');
  }
}

export class TokenServicePort {
  /**
   * @param {object} claims
   * @returns {Promise<string>} signed token
   */
  async sign(_claims) {
    throw new Error('TokenServicePort#sign is not implemented');
  }

  /**
   * @param {string} token
   * @returns {Promise<object>} decoded claims
   */
  async verify(_token) {
    throw new Error('TokenServicePort#verify is not implemented');
  }
}
