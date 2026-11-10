// The app's single honest email rail (extracted from routes/auth.ts):
// `console` prints instead of sending (development only), `mailtrap` uses the
// Mailtrap Email API via the official SDK, and `smtp` keeps the legacy SMTP
// transport. Sends are always real for the configured mode — misconfiguration
// fails loudly with EMAIL_UNAVAILABLE instead of pretending to send.
import nodemailer from 'nodemailer';
import { MailtrapClient } from 'mailtrap';
import { config } from '../config.js';
import { ApiError } from './http.js';

const UNAVAILABLE = new ApiError(503, 'EMAIL_UNAVAILABLE', 'Email delivery is not configured. Contact support.');

function body(subject: string, url: string) {
  return `${subject}\n\nOpen this link (expires automatically): ${url}\n\nIf you did not request this, ignore this message.`;
}

export async function mail(to: string, subject: string, url: string) {
  const c = config();
  if (c.EMAIL_MODE === 'console') {
    if (c.NODE_ENV === 'production') throw UNAVAILABLE; // boot gate forbids this; defense in depth
    console.info(`[DEVELOPMENT EMAIL ONLY] To: ${to} | ${subject} | ${url}`); return;
  }
  if (c.EMAIL_MODE === 'mailtrap') {
    if (!c.MAILTRAP_API_TOKEN || !c.MAILTRAP_FROM_EMAIL) throw UNAVAILABLE;
    // Sandbox (no verified sending domain needed) is a development/testing aid
    // only — production refuses it at boot; this guard keeps it honest anyway.
    const sandbox = c.MAILTRAP_USE_SANDBOX === 'true';
    if (sandbox && c.NODE_ENV === 'production') throw UNAVAILABLE;
    const inboxId = sandbox && c.MAILTRAP_INBOX_ID ? c.MAILTRAP_INBOX_ID : undefined;
    if (sandbox && !inboxId) throw UNAVAILABLE; // SDK requires a target inbox for sandbox sends
    const client = inboxId
      ? new MailtrapClient({ token: c.MAILTRAP_API_TOKEN, sandbox: true, testInboxId: inboxId })
      : new MailtrapClient({ token: c.MAILTRAP_API_TOKEN });
    await client.send({
      from: { email: c.MAILTRAP_FROM_EMAIL, name: c.MAILTRAP_FROM_NAME },
      to: [{ email: to }],
      subject,
      text: body(subject, url),
      category: 'DevRelay transactional',
    });
    return;
  }
  // Legacy SMTP rail (EMAIL_MODE=smtp), unchanged from the previous helper.
  if (!c.SMTP_HOST || !c.EMAIL_FROM) throw UNAVAILABLE;
  const transport = nodemailer.createTransport({ host: c.SMTP_HOST, port: c.SMTP_PORT, secure: c.SMTP_PORT === 465,
    auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASSWORD } : undefined });
  await transport.sendMail({ from: c.EMAIL_FROM, to, subject, text: body(subject, url) });
}
