import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleMailer } from '../../src/modules/auth/infrastructure/services/console-mailer.js';

test('sendMail prints recipient, subject and the reset link to stdout', async () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    const mailer = new ConsoleMailer();
    await mailer.sendMail({
      to: 'jperez@example.com',
      subject: 'Password reset',
      text: 'https://app.example.com/reset?token=raw-token-123',
    });
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(lines, [
    'To: jperez@example.com',
    'Subject: Password reset',
    'https://app.example.com/reset?token=raw-token-123',
  ]);
});
