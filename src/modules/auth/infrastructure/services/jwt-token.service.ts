import jwt from 'jsonwebtoken';
import type { TokenServicePort, TokenClaims } from '../../application/auth.ports.js';

/**
 * jsonwebtoken implementation of the TokenService port.
 *
 * Claims contract (design): the signed token carries
 * `{ sub, username, role, permissions, iat, exp, iss, aud }` — the caller
 * supplies sub/username/role/permissions; issuer, audience and expiry are
 * service-level options; `iat`/`exp` are added by jsonwebtoken. The
 * password hash is never a claim.
 */
export class JwtTokenService implements TokenServicePort {
  private readonly secret: string;
  private readonly expiresIn: string = '2h';
  private readonly issuer: string = 'SaludBack';
  private readonly audience: string = 'SaludBack-api';

  constructor(options: {
    secret: string;
    expiresIn?: string;
    issuer?: string;
    audience?: string;
  }) {
    this.secret = options.secret;
    if (options.expiresIn !== undefined) this.expiresIn = options.expiresIn;
    if (options.issuer !== undefined) this.issuer = options.issuer;
    if (options.audience !== undefined) this.audience = options.audience;
  }

  async sign(claims: TokenClaims): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      jwt.sign(
        claims as Record<string, unknown>,
        this.secret,
        {
          expiresIn: this.expiresIn as jwt.SignOptions['expiresIn'],
          issuer: this.issuer,
          audience: this.audience,
        },
        (err, token) => {
          if (err || !token) return reject(err);
          resolve(token);
        },
      );
    });
  }

  async verify(token: string): Promise<TokenClaims> {
    const decoded = jwt.verify(token, this.secret, {
      issuer: this.issuer,
      audience: this.audience,
    });
    return decoded as unknown as TokenClaims;
  }
}
