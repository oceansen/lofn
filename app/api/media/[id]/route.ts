import { Readable } from "node:stream";
import { one } from "@/lib/db";
import { notFound, route, ApiError } from "@/lib/http";
import { getAdmin, getParticipant, isUuid } from "@/lib/session";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** Authorised media access: the owning admin, or a participant of the same group. Supports Range for audio/video seeking. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  if (!isUuid(id)) throw notFound();
  const m = await one(
    `SELECT m.*, p.owner_id, p.status AS project_status, COALESCE(c.hidden, false) AS hidden
       FROM media m JOIN projects p ON p.id=m.project_id LEFT JOIN contributions c ON c.id=m.contribution_id WHERE m.id=$1`,
    [id],
  );
  if (!m) throw notFound();
  const admin = await getAdmin();
  let allowed = admin?.id === m.owner_id;
  if (!allowed) {
    const part = await getParticipant();
    allowed = !!part && part.group.id === m.group_id && part.group.code_active && m.project_status === "active" && !m.hidden;
  }
  if (!allowed) throw notFound();
  if (m.deleted_at) throw new ApiError(410, "This file was deleted under the project's media retention policy.");

  const s = storage();
  if (s.signedUrl) return Response.redirect(await s.signedUrl(m.storage_key, m.mime), 302);

  const size = Number(m.size_bytes);
  const headers: Record<string, string> = {
    "Content-Type": m.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'",
  };
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = await s.stream(m.storage_key, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = await s.stream(m.storage_key);
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
});
