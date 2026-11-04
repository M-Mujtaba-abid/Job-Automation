import { describe, expect, it } from "vitest";
import { z } from "zod";
import { retryDelayMs } from "@/server/jobs/backoff";
import { isAuthorizedCron, safeEqual } from "@/server/lib/cron-auth";
import { AppError, isUniqueViolation, toActionError } from "@/server/lib/errors";
import { redact } from "@/server/lib/logger";
import { uuidv7 } from "@/server/lib/uuid";

describe("uuidv7", () => {
  it("produces RFC 9562 v7 UUIDs with the timestamp in the first 48 bits", () => {
    const ms = Date.UTC(2026, 10, 4, 12, 0, 0);
    const id = uuidv7(ms);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(ms);
  });
  it("sorts by creation time across milliseconds", () => {
    const ids = [1, 2, 3].map((d) => uuidv7(1_700_000_000_000 + d));
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("retryDelayMs", () => {
  it("grows exponentially, is jittered within [exp/2, exp], and is capped", () => {
    expect(retryDelayMs(1, () => 0)).toBe(15_000);
    expect(retryDelayMs(1, () => 1)).toBe(30_000);
    expect(retryDelayMs(3, () => 1)).toBe(120_000);
    expect(retryDelayMs(50, () => 1)).toBe(6 * 3_600_000);
  });
});

describe("toActionError", () => {
  it("passes AppError codes and messages through", () => {
    expect(toActionError(new AppError("NOT_FOUND", "Job not found"))).toEqual({ code: "NOT_FOUND", message: "Job not found" });
    expect(toActionError(new AppError("RATE_LIMITED", "Slow down", { retryAfterSec: 30 }))).toMatchObject({ retryAfterSec: 30 });
  });
  it("maps Zod errors to VALIDATION_FAILED with field errors", () => {
    const r = z.object({ email: z.email() }).safeParse({ email: "nope" });
    const e = toActionError(r.error);
    expect(e.code).toBe("VALIDATION_FAILED");
    expect(e.fieldErrors?.email?.length).toBeGreaterThan(0);
  });
  it("never leaks unexpected error messages (v1 finding F2)", () => {
    const e = toActionError(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"));
    expect(e).toEqual({ code: "INTERNAL", message: "Something went wrong. Please try again." });
  });
});

describe("isUniqueViolation", () => {
  it("finds SQLSTATE 23505 directly or in a wrapped cause", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("wrapped", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("redact", () => {
  it("removes PII and secrets at any depth but keeps ids and counts", () => {
    const out = redact({
      userId: "u1",
      count: 3,
      email: "a@b.com",
      nested: { refreshToken: "x", list: [{ phone: "+92300" }], Authorization: "Bearer y" },
      error: new Error("boom"),
    });
    expect(out).toEqual({
      userId: "u1",
      count: 3,
      email: "[redacted]",
      nested: { refreshToken: "[redacted]", list: [{ phone: "[redacted]" }], Authorization: "[redacted]" },
      error: { name: "Error", message: "boom" },
    });
  });
});

describe("cron auth", () => {
  const secret = "s".repeat(32);
  const req = (h?: string) => new Request("http://x/api/cron/drain", h ? { headers: { authorization: h } } : {});
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCron(req(`Bearer ${secret}`), secret)).toBe(true);
    expect(isAuthorizedCron(req(`Bearer ${secret}x`), secret)).toBe(false);
    expect(isAuthorizedCron(req(), secret)).toBe(false);
  });
  it("rejects everything when the secret is missing or too short", () => {
    expect(isAuthorizedCron(req("Bearer short"), "short")).toBe(false);
    expect(isAuthorizedCron(req("Bearer "), undefined)).toBe(false);
  });
  it("safeEqual handles different lengths", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
  });
});
