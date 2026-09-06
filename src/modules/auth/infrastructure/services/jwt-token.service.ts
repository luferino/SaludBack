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
 *
 * The token header includes a `kid` (key id) that identifies which signing
 * secret was used. Verification supports the current secret plus an optional
 * list of previous secrets keyed by kid, enabling safe secret rotation
 * without downtime or runtime reload.
 */
export class JwtTokenService implements TokenServicePort {
  private readonly secret: string;
  private readonly secretKid: string;
  private readonly previousSecrets: { kid: string; secret: string }[];
  private readonly expiresIn: string = '2h';
  private readonly issuer: string = 'SaludBack';
  private readonly audience: string = 'SaludBack-api';

  constructor(options: {
    secret: string;
    secretKid?: string;
    previousSecrets?: { kid: string; secret: string }[];
    expiresIn?: string;
    issuer?: string;
    audience?: string;
  }) {
    this.secret = options.secret;
    this.secretKid = options.secretKid ?? 'current';
    this.previousSecrets = options.previousSecrets ?? [];
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
          keyid: this.secretKid,
        },
        (err, token) => {
          if (err || !token) return reject(err);
          resolve(token);
        },
      );
    });
  }

  async verify(token: string): Promise<TokenClaims> {
    const getKey = (
      header: jwt.JwtHeader,
      callback: jwt.SigningKeyCallback,
    ): void => {
      const kid = header.kid;

      // Legacy tokens without a kid: verify against the current secret.
      if (kid === undefined || kid === null) {
        callback(null, this.secret as jwt.Secret);
        return;
      }

      // Current kid maps to the current signing secret.
      if (kid === this.secretKid) {
        callback(null, this.secret as jwt.Secret);
        return;
      }

      // Look up in previous secrets.
      const match = this.previousSecrets.find((s) => s.kid === kid);
      if (match) {
        callback(null, match.secret as jwt.Secret);
        return;
      }

      callback(new Error(`Unknown JWT kid: ${kid}`));
    };

    return new Promise<TokenClaims>((resolve, reject) => {
      jwt.verify(
        token,
        getKey,
        { issuer: this.issuer, audience: this.audience },
        (err, decoded) => {
          if (err) return reject(err);
          resolve(decoded as unknown as TokenClaims);
        },
      );
    });
  }
}
