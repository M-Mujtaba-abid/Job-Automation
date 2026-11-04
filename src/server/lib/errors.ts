import "server-only";
import { z } from "zod";
import type { ActionError, ErrorCode } from "@/lib/action-result";

/** Expected, user-presentable failure. Anything else is treated as INTERNAL. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 402,
  INTEGRATION_ERROR: 502,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/**
 * Maps any thrown value to a safe client-facing error.
 * Unknown errors never leak their message (fixes v1 finding F2).
 */
export function toActionError(err: unknown): ActionError {
  if (err instanceof AppError) {
    const retryAfter = err.details?.retryAfterSec;
    return {
      code: err.code,
      message: err.message,
      ...(typeof retryAfter === "number" && { retryAfterSec: retryAfter }),
    };
  }
  if (err instanceof z.ZodError) {
    const fieldErrors = Object.fromEntries(
      Object.entries(z.flattenError(err).fieldErrors).filter(
        (entry): entry is [string, string[]] => Array.isArray(entry[1]),
      ),
    );
    return { code: "VALIDATION_FAILED", message: "Invalid input", fieldErrors };
  }
  return { code: "INTERNAL", message: "Something went wrong. Please try again." };
}

/** Postgres unique violation (SQLSTATE 23505), possibly wrapped by Drizzle in `cause`. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    if (typeof e === "object" && "code" in e && (e as { code?: unknown }).code === "23505") return true;
    e = typeof e === "object" && "cause" in e ? (e as { cause?: unknown }).cause : undefined;
  }
  return false;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
