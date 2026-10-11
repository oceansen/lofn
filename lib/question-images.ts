import { query } from "./db";
import { ApiError, badRequest } from "./http";

const MAX_BYTES = 8 * 1024 * 1024;

/** Validate (by magic bytes), downscale if large, and store a question's reference image. */
export async function saveQuestionImage(questionId: string, input: Buffer, alt: string, db?: { query: (t: string, p: unknown[]) => Promise<unknown> }) {
  if (input.length === 0) throw badRequest("The image is empty.");
  if (input.length > MAX_BYTES) throw new ApiError(413, "Images must be under 8 MB.");
  const { fileTypeFromBuffer } = await import("file-type");
  const t = await fileTypeFromBuffer(input);
  if (!t || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(t.mime)) throw new ApiError(415, "Use a PNG, JPEG, WebP or GIF image.");
  let data = input;
  let mime = t.mime;
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(input).metadata();
    if ((meta.width ?? 0) > 2000 || input.length > 1.5 * 1024 * 1024) {
      // Slides keep crisp text as PNG unless they are very large.
      const img = sharp(input).rotate().resize({ width: 2000, withoutEnlargement: true });
      const png = await img.clone().png({ compressionLevel: 9 }).toBuffer();
      if (png.length < 1.5 * 1024 * 1024) [data, mime] = [png, "image/png"];
      else [data, mime] = [await img.jpeg({ quality: 85 }).toBuffer(), "image/jpeg"];
    }
  } catch {
    // keep original if sharp is unavailable
  }
  const sql = `INSERT INTO question_images(question_id, mime, data, alt) VALUES ($1,$2,$3,$4)
               ON CONFLICT (question_id) DO UPDATE SET mime=EXCLUDED.mime, data=EXCLUDED.data, alt=EXCLUDED.alt, updated_at=now()`;
  const params = [questionId, mime, data, alt.slice(0, 500)];
  if (db) await db.query(sql, params);
  else await query(sql, params);
}
