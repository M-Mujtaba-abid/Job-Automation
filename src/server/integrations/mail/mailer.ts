import type { Logger } from "@/server/lib/logger";

/**
 * Outbound mail seam (SYSTEM_ARCHITECTURE §8.4, ADR-012/023).
 * Zero-cost: Gmail API adapter (user's own mailbox, OAuth app in Testing mode), added in M8.
 * Until then the no-op mailer records metadata only, so flows can be built and tested.
 */

export type OutgoingMessage = {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  replyTo?: string;
  attachments?: { fileName: string; mimeType: string; data: Buffer }[];
  /** Same key → provider-side dedupe where supported, and our unique index on email_messages. */
  idempotencyKey: string;
};

export type SendResult = { providerMessageId: string; threadId: string | null };

export interface Mailer {
  send(msg: OutgoingMessage): Promise<SendResult>;
}

/** Development/test mailer: sends nothing, logs only non-PII metadata. */
export function createNoopMailer(logger?: Logger): Mailer & { sent: OutgoingMessage[] } {
  const sent: OutgoingMessage[] = [];
  return {
    sent,
    async send(msg) {
      sent.push(msg);
      logger?.info({ idempotencyKey: msg.idempotencyKey, attachments: msg.attachments?.length ?? 0 }, "mail.noop_send");
      return { providerMessageId: `noop-${msg.idempotencyKey}`, threadId: null };
    },
  };
}
