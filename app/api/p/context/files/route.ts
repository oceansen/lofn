import fsp from "node:fs/promises";
import { ApiError, json, route } from "@/lib/http";
import { requireParticipant } from "@/lib/session";
import { requireConsent } from "@/lib/consent";
import { rateLimit } from "@/lib/security";
import { addContextFile, contextView, CONTEXT_LIMITS } from "@/lib/group-context";
import { requestToTempFile } from "@/lib/zip";

export const runtime = "nodejs";

/** Raw-body upload: POST /api/p/context/files?name=slides.pptx */
export const POST = route(async (req) => {
  const ctx = await requireParticipant();
  await requireConsent(ctx);
  if (!rateLimit(`ctxup:${ctx.participant.id}`, 20, 10 * 60_000)) throw new ApiError(429, "Too many uploads. Wait a few minutes.");
  const name = (new URL(req.url).searchParams.get("name") || "").trim();
  if (!name) throw new ApiError(400, "Missing file name.");
  const up = await requestToTempFile(req, CONTEXT_LIMITS.fileBytes);
  try {
    await addContextFile(ctx, up.path, name);
  } finally {
    await fsp.unlink(up.path).catch(() => {});
  }
  return json(await contextView(ctx.group.id, ctx.participant.id), { status: 201 });
});
