import { randomBytes } from "node:crypto";

/**
 * RFC 9562 UUID version 7: 48-bit Unix-ms timestamp + random bits.
 * Time-ordered for index locality, not enumerable (DATABASE_DESIGN §1). Dependency-free.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const b = randomBytes(16);
  let ts = BigInt(nowMs);
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
