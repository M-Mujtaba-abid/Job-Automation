/**
 * Shared result contract for Server Actions (plan/API_DESIGN.md §1).
 * Isomorphic: imported by client components to read action outcomes.
 */

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "INTEGRATION_ERROR",
  "SERVICE_UNAVAILABLE",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ActionError = {
  code: ErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
  retryAfterSec?: number;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
