import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TenantContext } from "@/server/auth/session";
import { authedAction } from "@/server/lib/action";
import { AppError } from "@/server/lib/errors";
import { route } from "@/server/lib/route";
import { safeNextPath } from "@/lib/safe-redirect";

process.env.LOG_LEVEL = "error";
const alice: TenantContext = { userId: "u-alice", role: "USER", email: "alice@example.com", name: "Alice" };
const signedIn = async () => alice;
const signedOut = async (): Promise<TenantContext> => {
  throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
};
const noLimit = async () => {};

describe("authedAction", () => {
  const input = z.object({ headline: z.string().trim().min(1).max(10) });

  it("passes validated input and the session context to the handler", async () => {
    const handler = vi.fn(async ({ input, ctx }: { input: { headline: string }; ctx: TenantContext }) => ({
      saved: input.headline,
      by: ctx.userId,
    }));
    const action = authedAction({
      name: "t.ok",
      input,
      handler,
      deps: { resolveContext: signedIn, rateLimit: noLimit },
    });
    expect(await action({ headline: "  Dev  " })).toEqual({ ok: true, data: { saved: "Dev", by: "u-alice" } });
  });

  it("returns UNAUTHENTICATED without running the handler when signed out", async () => {
    const handler = vi.fn();
    const action = authedAction({
      name: "t.auth",
      input,
      handler,
      deps: { resolveContext: signedOut, rateLimit: noLimit },
    });
    expect(await action({ headline: "x" })).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns field errors for invalid input, including FormData", async () => {
    const action = authedAction({
      name: "t.val",
      input,
      handler: async () => "never",
      deps: { resolveContext: signedIn, rateLimit: noLimit },
    });
    const fd = new FormData();
    fd.set("headline", "this is far too long");
    const res = await action(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.fieldErrors?.headline?.length).toBeGreaterThan(0);
  });

  it("rate-limits per user and action, and masks unexpected errors", async () => {
    const rateLimit = vi.fn(async () => {});
    const action = authedAction({
      name: "t.boom",
      input,
      rateLimit: { points: 5, windowSec: 60 },
      handler: async () => {
        throw new Error("db password=secret leaked?");
      },
      deps: { resolveContext: signedIn, rateLimit },
    });
    const res = await action({ headline: "x" });
    expect(rateLimit).toHaveBeenCalledWith("action:t.boom:u-alice", { points: 5, windowSec: 60 });
    expect(res).toEqual({ ok: false, error: { code: "INTERNAL", message: "Something went wrong. Please try again." } });
  });

  it("surfaces RATE_LIMITED with retryAfterSec", async () => {
    const action = authedAction({
      name: "t.rl",
      input,
      rateLimit: { points: 1, windowSec: 60 },
      handler: async () => "x",
      deps: {
        resolveContext: signedIn,
        rateLimit: async () => {
          throw new AppError("RATE_LIMITED", "Too many requests.", { retryAfterSec: 42 });
        },
      },
    });
    expect(await action({ headline: "x" })).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED", retryAfterSec: 42 },
    });
  });
});

describe("route()", () => {
  const segment = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

  it("validates params and returns JSON with no-store and a request id", async () => {
    const GET = route(
      { name: "t.get", auth: "session", params: z.object({ id: z.uuid() }), resolveContext: signedIn },
      async ({ params, ctx }) => ({ id: params.id, user: ctx.userId }),
    );
    const id = "0195f0c4-2c5e-7d1a-9b3e-3f6c1a2b4c5d";
    const res = await GET(new Request("http://x/api/t", { headers: { "x-request-id": "req-9" } }), segment({ id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBe("req-9");
    expect(await res.json()).toEqual({ id, user: "u-alice" });

    const bad = await GET(new Request("http://x/api/t"), segment({ id: "not-a-uuid" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("VALIDATION_FAILED");
  });

  it("maps auth failures to 401 and unknown errors to a generic 500", async () => {
    const GET401 = route({ name: "t.401", auth: "session", resolveContext: signedOut }, async () => ({}));
    const r401 = await GET401(new Request("http://x"), segment({}));
    expect(r401.status).toBe(401);

    const GET500 = route({ name: "t.500", auth: "none" }, async () => {
      throw new Error("internal detail");
    });
    const r500 = await GET500(new Request("http://x"), segment({}));
    expect(r500.status).toBe(500);
    const body = await r500.json();
    expect(body.error.message).not.toContain("internal detail");
    expect(body.error.requestId).toBeTruthy();
  });

  it("cron mode requires the bearer secret", async () => {
    process.env.CRON_SECRET = "c".repeat(32);
    const GET = route({ name: "t.cron", auth: "cron" }, async () => ({ ran: true }));
    expect((await GET(new Request("http://x"), segment({}))).status).toBe(401);
    const ok = await GET(
      new Request("http://x", { headers: { authorization: `Bearer ${"c".repeat(32)}` } }),
      segment({}),
    );
    expect(await ok.json()).toEqual({ ran: true });
  });
});

describe("safeNextPath", () => {
  it("allows same-site relative paths only", () => {
    expect(safeNextPath("/account?tab=1")).toBe("/account?tab=1");
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "account",
      "/a\nb",
      "",
    ]) {
      expect(safeNextPath(bad)).toBe("/account");
    }
    expect(safeNextPath(["/onboarding", "/x"])).toBe("/onboarding");
    expect(safeNextPath(undefined, "/dashboard")).toBe("/dashboard");
  });
});
