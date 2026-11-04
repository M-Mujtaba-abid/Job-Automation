import { describe, expect, it } from "vitest";
import { createNoopMailer } from "@/server/integrations/mail/mailer";
import { assertValidKey, createMemoryFileStore, MAX_FILE_BYTES } from "@/server/integrations/storage/file-store";

describe("FileStore (memory adapter)", () => {
  it("round-trips bytes and returns copies (no shared mutable buffers)", async () => {
    const store = createMemoryFileStore();
    const data = Buffer.from("%PDF-1.7 synthetic");
    await store.put("resumes/u1/v1", data, { mimeType: "application/pdf" });
    data[0] = 0;
    const got = await store.get("resumes/u1/v1");
    expect(got?.data.toString("latin1").startsWith("%PDF-")).toBe(true);
    expect(got).toMatchObject({ mimeType: "application/pdf", sizeBytes: 18 });
    await store.delete("resumes/u1/v1");
    expect(await store.get("resumes/u1/v1")).toBeNull();
  });

  it("rejects path traversal and oversized files", async () => {
    for (const bad of ["../etc/passwd", "resumes//x", "/abs", "UPPER", "a/../b", ""]) {
      expect(() => assertValidKey(bad)).toThrow();
    }
    const store = createMemoryFileStore();
    await expect(store.put("big", Buffer.alloc(MAX_FILE_BYTES + 1), { mimeType: "application/pdf" })).rejects.toThrow(
      /too large/,
    );
  });
});

describe("Mailer (no-op adapter)", () => {
  it("records messages and returns a deterministic id per idempotency key", async () => {
    const mailer = createNoopMailer();
    const r = await mailer.send({
      from: "me@example.com",
      to: "hr@example.com",
      subject: "s",
      bodyText: "b",
      idempotencyKey: "k1",
    });
    expect(r).toEqual({ providerMessageId: "noop-k1", threadId: null });
    expect(mailer.sent).toHaveLength(1);
  });
});
