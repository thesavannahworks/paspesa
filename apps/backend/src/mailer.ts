/**
 * Outgoing email (sign-in codes). Four options (priority order):
 *
 * 1. SendGrid (recommended - works on Railway, can verify individual sender):
 *    SENDGRID_API_KEY=SG....
 *    MAIL_FROM="Paspesa <thesavannahworks@gmail.com>"  (must be verified in SendGrid)
 *
 * 2. Resend (requires custom domain for production):
 *    RESEND_API_KEY=re_...
 *    MAIL_FROM="Paspesa <onboarding@resend.dev>"  (testing only, or custom domain)
 *
 * 3. SMTP (blocked by Railway and most cloud providers):
 *    SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, MAIL_FROM
 *
 * 4. Console (development only - prints codes to logs):
 *    Leave all API keys and SMTP_HOST unset
 */
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import sgMail from '@sendgrid/mail';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  /** Email service being used. */
  readonly kind: 'sendgrid' | 'resend' | 'smtp' | 'console' | 'memory';
  send(mail: Mail): Promise<void>;
}

export function mailerFromEnv(env: NodeJS.ProcessEnv): Mailer {
  // Priority 1: SendGrid (works on Railway, can verify individual email addresses)
  if (env.SENDGRID_API_KEY) {
    sgMail.setApiKey(env.SENDGRID_API_KEY);
    const from = env.MAIL_FROM || 'Paspesa <noreply@example.com>';
    return {
      kind: 'sendgrid',
      async send(mail) {
        await sgMail.send({
          from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        });
      },
    };
  }

  // Priority 2: Resend (works on Railway but requires custom domain for production)
  if (env.RESEND_API_KEY) {
    const resend = new Resend(env.RESEND_API_KEY);
    const from = env.MAIL_FROM || 'Paspesa <onboarding@resend.dev>';
    return {
      kind: 'resend',
      async send(mail) {
        await resend.emails.send({
          from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        });
      },
    };
  }

  // Priority 3: SMTP (blocked by Railway)
  if (env.SMTP_HOST) {
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

  // Fallback: Console logging (development)
  return {
    kind: 'console',
    async send(mail) {
      console.log(`[paspesa] email (no mail service configured — printed instead)\n  to: ${mail.to}\n  subject: ${mail.subject}\n  ${mail.text.replace(/\n/g, '\n  ')}`);
    },
  };
}

/** Test mailer: keeps what was sent. */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { kind: 'memory', sent, async send(mail) { sent.push(mail); } };
}
