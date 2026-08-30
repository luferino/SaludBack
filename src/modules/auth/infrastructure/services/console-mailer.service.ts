import type { MailerPort, MailMessage } from '../../application/auth.ports.js';

/**
 * Console transport for the MailerPort (design D1). Prints the message
 * to stdout so reset links are observable in dev and in tests; real SMTP
 * delivery is a future adapter — swapping transports is a wiring change
 * in index.js only, never a use-case change.
 */
export class ConsoleMailer implements MailerPort {
  async sendMail({ to, subject, text }: MailMessage): Promise<void> {
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text);
  }
}
