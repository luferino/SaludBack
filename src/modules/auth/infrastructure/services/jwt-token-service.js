import jwt from 'jsonwebtoken';
import { TokenServicePort } from '../../application/ports.js';

/**
 * jsonwebtoken implementation of the TokenService port.
 *
 * Claims contract (design): the signed token carries
 * `{ sub, username, role, permissions, iat, exp, iss, aud }` — the caller
 * supplies sub/username/role/permissions; issuer, audience and expiry are
 * service-level options; `iat`/`exp` are added by jsonwebtoken. The
 * password hash is never a claim.
 */
export class JwtTokenService extends TokenServicePort {
  constructor({ secret, expiresIn = '2h', issuer = 'SaludBack', audience = 'SaludBack-api' } = {}) {
    super();
    this.secret = secret;
    this.expiresIn = expiresIn;
    this.issuer = issuer;
    this.audience = audience;
  }

  async sign(claims) {
    return jwt.sign(claims, this.secret, {
      expiresIn: this.expiresIn,
      issuer: this.issuer,
      audience: this.audience,
    });
  }

  /**
   * @returns {Promise<object>} decoded claims
   * @throws {Error} when the token is invalid, expired, or signed with a
   * different secret/issuer/audience (jsonwebtoken errors).
   */
  async verify(token) {
    return jwt.verify(token, this.secret, {
      issuer: this.issuer,
      audience: this.audience,
    });
  }
}
