import { describe, expect, it } from "vitest";
import { applySecurityHeaders, REQUEST_ID_HEADER } from "@/lib/security-headers";

describe("applySecurityHeaders", () => {
  it("sets the baseline headers and the request id", () => {
    const h = new Headers();
    applySecurityHeaders(h, { requestId: "req-1", production: false });
    expect(h.get(REQUEST_ID_HEADER)).toBe("req-1");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Content-Security-Policy-Report-Only")).toContain("frame-ancestors 'none'");
    expect(h.get("Strict-Transport-Security")).toBeNull();
  });
  it("adds HSTS only in production", () => {
    const h = new Headers();
    applySecurityHeaders(h, { requestId: "r", production: true });
    expect(h.get("Strict-Transport-Security")).toContain("max-age=");
  });
});
