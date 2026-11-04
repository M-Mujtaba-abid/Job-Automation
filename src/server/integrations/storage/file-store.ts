/**
 * File storage seam (SYSTEM_ARCHITECTURE §8.4, ADR-009/023).
 * Zero-cost: Postgres `resume_files` (bytea) adapter, added in M2 together with that table.
 * Scale: S3/R2 adapter. Keys are always generated server-side (never from user input).
 */

export type StoredFile = { data: Buffer; mimeType: string; sizeBytes: number };

export interface FileStore {
  put(key: string, data: Buffer, meta: { mimeType: string }): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
}

/** Size cap shared by every adapter (Vercel request limit; SECURITY_DESIGN §4). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

const KEY_RE = /^[a-z0-9][a-z0-9/_-]{0,200}$/;

export function assertValidKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) throw new Error("Invalid storage key");
}

/** In-memory adapter for tests and local development. */
export function createMemoryFileStore(): FileStore & { size(): number } {
  const files = new Map<string, StoredFile>();
  return {
    async put(key, data, { mimeType }) {
      assertValidKey(key);
      if (data.length > MAX_FILE_BYTES) throw new Error("File too large");
      files.set(key, { data: Buffer.from(data), mimeType, sizeBytes: data.length });
    },
    async get(key) {
      assertValidKey(key);
      const f = files.get(key);
      return f ? { ...f, data: Buffer.from(f.data) } : null;
    },
    async delete(key) {
      assertValidKey(key);
      files.delete(key);
    },
    size: () => files.size,
  };
}
