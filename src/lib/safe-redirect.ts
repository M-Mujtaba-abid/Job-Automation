/**
 * Open-redirect guard (SECURITY_DESIGN §10): only same-site relative paths are allowed.
 * Rejects absolute URLs, protocol-relative "//evil.com", backslash tricks and control characters.
 */
export function safeNextPath(value: string | string[] | undefined | null, fallback = "/account"): string {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || v.length > 512) return fallback;
  if (!/^\/(?![/\\])/.test(v)) return fallback;
  if (/[\u0000-\u001f\\]/.test(v)) return fallback;
  return v;
}
