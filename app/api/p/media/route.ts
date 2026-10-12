import { badRequest, json, route } from "@/lib/http";
import { requireParticipant } from "@/lib/session";
import { saveUpload } from "@/lib/contributions";
import { one } from "@/lib/db";
import { rateLimit } from "@/lib/security";
import { ApiError } from "@/lib/http";
import { requireConsent } from "@/lib/consent";

export const runtime = "nodejs";

/** Raw-body streaming upload: POST /api/p/media?category=image|audio|video&name=photo.jpg */
export const POST = route(async (req) => {
  const ctx = await requireParticipant();
  if (!rateLimit(`upload:${ctx.participant.id}`, 30, 60_000)) throw new ApiError(429, "You're uploading very quickly. Wait a moment and try again.");
  await requireConsent(ctx, "recordings");
  const sp = new URL(req.url).searchParams;
  const category = sp.get("category");
  if (category !== "image" && category !== "audio" && category !== "video") throw badRequest("Unknown media category.");
  const live = await one(`SELECT 1 FROM cycles WHERE project_id=$1 AND status='running'`, [ctx.project.id]);
  if (!live) throw new ApiError(409, "The session isn't open for contributions right now.");
  const m = await saveUpload(req, ctx, category, sp.get("name") || "");
  return json({ media: m }, { status: 201 });
});
