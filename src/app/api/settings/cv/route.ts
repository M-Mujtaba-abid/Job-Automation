import { ApiError, route } from "@/legacy/api";
import { CV_MAX_BYTES, deleteCv, getCv, isPdf, saveCv } from "@/legacy/cv";

/** View / download the stored CV (session-protected). */
export const GET = route(async () => {
  const cv = await getCv();
  if (!cv) throw new ApiError(404, "No CV uploaded");
  return new Response(new Uint8Array(cv.data), {
    headers: {
      "Content-Type": cv.mimeType,
      "Content-Disposition": `inline; filename="${cv.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
});

/** Upload / replace the CV (PDF, stored in Neon). */
export const POST = route(async (req) => {
  const form = await req.formData().catch(() => {
    throw new ApiError(400, "Expected multipart form data");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "No file uploaded");
  if (file.size > CV_MAX_BYTES) throw new ApiError(400, "CV must be 4 MB or smaller");

  const data = Buffer.from(await file.arrayBuffer());
  if (!isPdf(data)) throw new ApiError(400, "CV must be a PDF");

  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 100) || "CV.pdf";
  return saveCv(safeName.toLowerCase().endsWith(".pdf") ? safeName : `${safeName}.pdf`, data);
});

export const DELETE = route(async () => {
  await deleteCv();
  return { ok: true };
});
