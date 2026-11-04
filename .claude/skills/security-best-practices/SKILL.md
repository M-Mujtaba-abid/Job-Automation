---
name: security-best-practices
description: Concrete security implementations for this project - envelope encryption of OAuth tokens (AES-256-GCM), secure upload validation, SSRF guard, CSP/security headers in proxy.ts, PII redaction for logs/Sentry, rate limiting, webhook signatures, secrets handling, tenant isolation checks, and security review checklists mapped to OWASP. Use when touching auth, sessions, tokens, uploads, URLs fetched server-side, headers/CSP, logging of user data, webhooks, or when reviewing a change for security.
---

# Security Best Practices

## When to activate
- Any change in: auth/session code, `EmailAccount` tokens, crypto helpers, upload/download handlers, `proxy.ts` headers, logger/Sentry config, webhook receivers, rate limiting, automation worker, admin features.
- Security review of a PR (use the checklist at the end).
Design: `plan/SECURITY_DESIGN.md`. Rules: `.claude/rules/security-rules.md`.

## 1. Envelope encryption for OAuth tokens
```ts
// src/server/lib/crypto.ts
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;                       // format version byte
const IV_LEN = 12, TAG_LEN = 16, KEY_LEN = 32;

/** Encrypts with a fresh data key; the data key is wrapped by the master key (KMS in production). */
export async function sealSecret(plaintext: string, aad: string, keyring: Keyring): Promise<Buffer> {
  const dataKey = randomBytes(KEY_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));                 // binds ciphertext to owner (userId:emailAccountId)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const { keyVersion, wrapped } = await keyring.wrap(dataKey);
  dataKey.fill(0);
  // [version(1)][keyVersion(2)][wrappedLen(2)][wrapped][iv(12)][tag(16)][ct]
  const header = Buffer.alloc(5);
  header.writeUInt8(VERSION, 0); header.writeUInt16BE(keyVersion, 1); header.writeUInt16BE(wrapped.length, 3);
  return Buffer.concat([header, wrapped, iv, tag, ct]);
}

export async function openSecret(sealed: Buffer, aad: string, keyring: Keyring): Promise<string> {
  if (sealed.readUInt8(0) !== VERSION) throw new Error("Unsupported ciphertext version");
  const keyVersion = sealed.readUInt16BE(1), wrappedLen = sealed.readUInt16BE(3);
  let o = 5;
  const wrapped = sealed.subarray(o, (o += wrappedLen));
  const iv = sealed.subarray(o, (o += IV_LEN));
  const tag = sealed.subarray(o, (o += TAG_LEN));
  const ct = sealed.subarray(o);
  const dataKey = await keyring.unwrap(keyVersion, wrapped);
  try {
    const decipher = createDecipheriv("aes-256-gcm", dataKey, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");   // throws on tamper/AAD mismatch
  } finally {
    dataKey.fill(0);
  }
}
```
`Keyring` implementations: `KmsKeyring` (production: AWS/GCP KMS wrap/unwrap) and `LocalKeyring` (dev/early prod: AES-256-GCM wrap with `ENCRYPTION_MASTER_KEY_V<n>` env keys). Rotation = new key version for writes + re-encrypt job.
**Tests:** round-trip; tamper any byte → throws; wrong AAD → throws; unknown key version → throws; plaintext never appears in logs (spy logger).

## 2. Upload validation
```ts
const MAX_BYTES = 4 * 1024 * 1024;

export async function readUploadSafely(file: File): Promise<{ bytes: Buffer; type: "PDF" | "DOCX" }> {
  if (file.size > MAX_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "File must be 4 MB or smaller");
  const bytes = Buffer.from(await file.arrayBuffer());              // size already bounded; stream-abort at platform limit too
  if (bytes.length > MAX_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "File must be 4 MB or smaller");

  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") {        // v1 isPdf check
    if (await isEncryptedPdf(bytes)) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Password-protected PDFs aren't supported");
    return { bytes, type: "PDF" };
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {                     // ZIP → must be a real DOCX, macro-free, bounded
    const entries = await listZipEntries(bytes, { maxEntries: 500, maxUncompressedBytes: 25 * 1024 * 1024 });
    const isDocx = entries.has("word/document.xml") && entries.has("[Content_Types].xml");
    if (!isDocx || entries.has("word/vbaProject.bin")) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Upload a PDF or DOCX file");
    return { bytes, type: "DOCX" };
  }
  throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Upload a PDF or DOCX file");
}
```
Then: SHA-256, server-generated storage key, put to private bucket, DB row after successful put, enqueue parse. Downloads: ownership check → presigned GET ≤ 300 s with `response-content-disposition=attachment`.

## 3. SSRF guard (any server-side fetch of user/third-party URLs)
```ts
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export async function assertPublicUrl(raw: string, opts = { allowedPorts: [443] }) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new AppError("VALIDATION_FAILED", "Only https URLs are allowed");
  if (url.username || url.password) throw new AppError("VALIDATION_FAILED", "Credentials in URL are not allowed");
  const port = url.port ? Number(url.port) : 443;
  if (!opts.allowedPorts.includes(port)) throw new AppError("VALIDATION_FAILED", "Port not allowed");
  const addrs = await lookup(url.hostname, { all: true, verbatim: true });
  for (const { address } of addrs) {
    const range = ipaddr.process(address).range();
    if (range !== "unicast") throw new AppError("VALIDATION_FAILED", "Destination not allowed");   // blocks private, loopback, link-local (169.254.x: metadata), CGNAT, multicast, reserved
  }
  return url;
}
```
Fetch with `redirect: "manual"` and re-validate every hop; timeout ≤ 10 s; response size cap; content-type allowlist. Extends v1 `isPublicHost` (which checked hostnames only, not resolved IPs; DNS rebinding remains a residual risk; pin the resolved IP for the request where the HTTP client supports it).

## 4. Security headers & CSP (proxy.ts)
```ts
const nonce = btoa(crypto.randomUUID());
const csp = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
  "style-src 'self' 'unsafe-inline'",              // tighten if/when feasible
  `img-src 'self' data: blob: ${env.STORAGE_PUBLIC_ORIGIN}`,
  `connect-src 'self' ${env.SENTRY_ORIGIN}`,
  "frame-src 'self'",                              // resume preview iframe origin if separate
  "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");
res.headers.set("Content-Security-Policy", csp);   // start as Content-Security-Policy-Report-Only in M0
res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
res.headers.set("X-Content-Type-Options", "nosniff");
res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
```
Pass the nonce to the app via a request header and read it in the root layout per the installed Next.js CSP guide (verify in `node_modules/next/dist/docs/`).

## 5. PII redaction
```ts
// src/server/lib/logger.ts
export const logger = pino({
  redact: {
    paths: ["*.email", "*.phone", "*.password", "*.token", "*.accessToken", "*.refreshToken", "*.authorization",
            "*.extractedText", "*.bodyText", "*.coverLetter", "*.answers", "*.resume", "req.headers.cookie", "req.headers.authorization"],
    censor: "[redacted]",
  },
});
// Sentry: sendDefaultPii: false; beforeSend strips request bodies, cookies, query strings, and known PII keys; breadcrumbs exclude console args.
```
**Rule of thumb:** log ids and counts, not content. Unit-test the redaction config with sample objects.

## 6. Rate limiting
```ts
// src/server/lib/rate-limit.ts (rate-limiter-flexible; zero-cost profile: RateLimiterPostgres on Neon, scale: Redis store)
export async function consumeRateLimit(key: string, { points, durationSec }: Limit) {
  try { await limiter(points, durationSec).consume(key); }
  catch (res) {
    if (res instanceof RateLimiterRes) throw new AppError("RATE_LIMITED", "Too many requests", { retryAfterSec: Math.ceil(res.msBeforeNext / 1000) });
    throw res;   // Redis down → fail closed for auth/sends, fail open (with alert) for cheap reads
  }
}
```
Keys: `ip:<hash>` for unauthenticated, `<action>:<userId>` for authenticated, `host:<domain>` / `mail:<accountId>` in workers.

## 7. Webhook signatures
- HMAC-SHA256 over the **raw** body (+ timestamp), constant-time compare, ≤ 5-minute tolerance, idempotency via `WebhookEvent(provider, eventId)` unique. Use the provider SDK's verifier when one exists.
- Legacy Apify: dedicated secret in a header via webhook `headersTemplate`; body ignored; run status re-fetched (fixes v1 F1).

## 8. Tenant isolation checks
- Repository functions require `ctx`; ESLint rule forbids importing `db` outside `src/server/db` and `**/repository.ts` / `**/*-repository.ts`; `sql.raw()` with non-constant input is banned.
- Tenancy registry test (TESTING_STRATEGY §3.3) fails if a model with `userId` lacks isolation tests.

## 9. Secrets handling
- Env via Zod schemas per process; missing/short secrets fail startup (v1 pattern).
- Never `console.log(env())`; never include env in error details.
- `.env*` files are denied to Claude Code (`.claude/settings.json`). If a secret is exposed, rotate it immediately and record it in the incident log.

## Anti-patterns
- ❌ `crypto.createCipher` (deprecated), AES-CBC without MAC, static IVs, encrypting with `BETTER_AUTH_SECRET` (or v1's `AUTH_SECRET`): session secrets are never encryption keys.
- ❌ Trusting `file.type` or file extensions.
- ❌ Fetching user URLs with plain `fetch(url)`.
- ❌ CSP with `'unsafe-eval'` or wildcard sources.
- ❌ Logging request bodies or full error objects from integrations (may contain tokens/PII).
- ❌ Secrets in URLs (query strings end up in logs).
- ❌ Fail-open rate limiting on auth or send endpoints.

## Security review checklist (OWASP-mapped)
- **A01 Access control:** `ctx` scoping on every query; NOT_FOUND for foreign ids; admin checks + audit.
- **A02 Crypto:** tokens sealed with `sealSecret`; TLS everywhere; no custom crypto beyond the helper.
- **A03 Injection:** Zod on inputs; no unsafe raw SQL; no HTML injection; LLM inputs delimited.
- **A04 Insecure design:** approvals for irreversible actions; bounded AI influence; quotas.
- **A05 Misconfiguration:** headers/CSP intact; buckets private; debug off; `Cache-Control: no-store` on private responses.
- **A06 Components:** new deps justified; `npm audit` clean (high+).
- **A07 Auth:** wrappers used; session revocation; rate limits on auth.
- **A08 Integrity:** webhook signatures; lockfile changes reviewed.
- **A09 Logging:** security events audited; no PII in logs.
- **A10 SSRF:** `assertPublicUrl` for any server-side fetch of non-allowlisted URLs.
- **LLM:** injection eval passing; outputs schema-validated; no external tools for the model.

## Testing requirements
- Unit: crypto (tamper/AAD/version), upload validator (spoofed magic bytes, zip bomb, macro DOCX, encrypted PDF), SSRF guard (private IPv4/IPv6, metadata IP, redirect to private), redaction config, rate-limit error mapping.
- Integration: tenancy suite; webhook replay; OAuth state misuse.
- CI: gitleaks, Semgrep custom rules, ZAP baseline nightly.
