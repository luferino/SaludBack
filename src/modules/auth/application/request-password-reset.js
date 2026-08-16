import { createHash, randomBytes } from 'node:crypto';
import { BadRequestError } from '../../shared/domain/errors.js';

const GENERIC_SUCCESS_MESSAGE = 'If the account exists, a password reset link has been sent';

/**
 * Request Password Reset use case.
 * Every non-400 outcome returns the same generic body (anti-enumeration,
 * design D6): unknown username and users without an email both fold into
 * "no mail". When a token is issued, only the sha256 hash is persisted
 * (D3) and the raw token travels exclusively inside the mailed link
 * `{clientUrl}?token=<raw>`. Ports (userRepository, resetTokenRepository,
 * mailer) and the runtime values (clientUrl, resetTokenTtl) are injected —
 * no env access inside the use case (D9).
 */
export class RequestPasswordReset {
  constructor({ repository, resetTokenRepository, mailer, clientUrl, resetTokenTtl }) {
    this.repository = repository;
    this.resetTokenRepository = resetTokenRepository;
    this.mailer = mailer;
    this.clientUrl = clientUrl;
    this.resetTokenTtl = resetTokenTtl;
  }

  async execute({ username } = {}) {
    if (!username || username.trim() === '') {
      throw new BadRequestError('username is required');
    }

    const user = await this.repository.findByUsername(username);
    if (!user || !user.email) {
      return { message: GENERIC_SUCCESS_MESSAGE };
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + this.resetTokenTtl * 60_000);

    await this.resetTokenRepository.create({ userId: user.id, tokenHash, expiresAt });
    await this.mailer.sendMail({
      to: user.email,
      subject: 'Password reset',
      text: `${this.clientUrl}?token=${rawToken}`,
    });

    return { message: GENERIC_SUCCESS_MESSAGE };
  }
}
