/**
 * Security headers set by proxy.ts on every response (SECURITY_DESIGN §11).
 * CSP is report-only in M0 so v1 pages keep working; it is switched to enforce
 * (with per-request nonces) once v2 pages replace v1 (M12 at the latest).
 * Edge-safe: no Node APIs.
 */

export const REQUEST_ID_HEADER = "x-request-id";

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function applySecurityHeaders(headers: Headers, opts: { requestId: string; production: boolean }): true {
  headers.set(REQUEST_ID_HEADER, opts.requestId);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Content-Security-Policy-Report-Only", CSP_REPORT_ONLY);
  if (opts.production) headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return true;
}
