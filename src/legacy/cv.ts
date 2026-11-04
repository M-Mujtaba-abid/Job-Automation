import { eq } from "drizzle-orm";
import { db } from "@/legacy/db";
import { cvFile } from "@/legacy/db/schema";

/** Vercel rejects request bodies over 4.5 MB, so uploads are capped below that. */
export const CV_MAX_BYTES = 4 * 1024 * 1024;

export type CvMeta = { fileName: string; size: number; updatedAt: Date };

/** CV metadata without the file bytes (cheap; used for UI and checks). */
export async function getCvMeta(): Promise<CvMeta | null> {
  const [row] = await db()
    .select({ fileName: cvFile.fileName, size: cvFile.size, updatedAt: cvFile.updatedAt })
    .from(cvFile)
    .where(eq(cvFile.id, 1));
  return row ?? null;
}

/** CV including bytes (for attaching / downloading). */
export async function getCv(): Promise<{ fileName: string; mimeType: string; data: Buffer } | null> {
  const [row] = await db()
    .select({ fileName: cvFile.fileName, mimeType: cvFile.mimeType, data: cvFile.data })
    .from(cvFile)
    .where(eq(cvFile.id, 1));
  return row ?? null;
}

export async function saveCv(fileName: string, data: Buffer): Promise<CvMeta> {
  const values = { id: 1, fileName, size: data.length, data, mimeType: "application/pdf" };
  const [row] = await db()
    .insert(cvFile)
    .values(values)
    .onConflictDoUpdate({ target: cvFile.id, set: { ...values, updatedAt: new Date() } })
    .returning({ fileName: cvFile.fileName, size: cvFile.size, updatedAt: cvFile.updatedAt });
  return row;
}

export async function deleteCv(): Promise<void> {
  await db().delete(cvFile).where(eq(cvFile.id, 1));
}

/** Real PDFs start with "%PDF-" — don't trust the browser's MIME type alone. */
export function isPdf(data: Buffer): boolean {
  return data.subarray(0, 5).toString("latin1") === "%PDF-";
}
