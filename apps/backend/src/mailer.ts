/**
 * Outgoing email (sign-in codes). SMTP settings come from the environment:
 *
 *   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, MAIL_FROM ("Paspesa <you@gmail.com>")
 *
 * Gmail works with an App Password (Google account → Security → 2-Step Verification → App passwords).
 * Without SMTP settings, emails are printed in the backend's console instead — for local development only.
 */
import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  /** 'smtp' sends real email; 'console' prints it (development). */
  readonly kind: 'smtp' | 'console' | 'memory';
  send(mail: Mail): Promise<void>;
}

export function mailerFromEnv(env: NodeJS.ProcessEnv): Mailer {
  if (!env.SMTP_HOST) {
    return {
      kind: 'console',
      async send(mail) {
        console.log(`[paspesa] email (SMTP not configured — printed instead)\n  to: ${mail.to}\n  subject: ${mail.subject}\n  ${mail.text.replace(/\n/g, '\n  ')}`);
      },
    };
  }
  const port = Number(env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
  });
  const from = env.MAIL_FROM || env.SMTP_USER || 'Paspesa <no-reply@localhost>';
  return {
    kind: 'smtp',
    async send(mail) {
      await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    },
  };
}

/** Test mailer: keeps what was sent. */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { kind: 'memory', sent, async send(mail) { sent.push(mail); } };
}
