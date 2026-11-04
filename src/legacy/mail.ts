import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/legacy/env";
import { textToHtml } from "@/legacy/template";

const globalForMail = globalThis as unknown as { __mailer?: Transporter };

export function mailer(): Transporter {
  if (!globalForMail.__mailer) {
    const e = env();
    globalForMail.__mailer = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      auth: { user: e.SMTP_USER, pass: e.SMTP_PASS },
    });
  }
  return globalForMail.__mailer;
}

export type OutgoingMail = {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  cv?: { fileName: string; data: Buffer } | null;
};

export async function sendMail(m: OutgoingMail): Promise<string> {
  const info = await mailer().sendMail({
    from: env().MAIL_FROM,
    to: m.to,
    replyTo: m.replyTo || undefined,
    subject: m.subject,
    text: m.body,
    html: textToHtml(m.body),
    attachments: m.cv ? [{ filename: m.cv.fileName, content: m.cv.data, contentType: "application/pdf" }] : [],
  });
  return info.messageId;
}
