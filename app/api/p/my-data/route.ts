import fsp from "node:fs/promises";
import { ApiError, json, route } from "@/lib/http";
import { requireParticipant } from "@/lib/session";
import { eraseContributions, participantData } from "@/lib/consent";
import { exportParticipantArchive, importParticipantArchive } from "@/lib/participant-archive";
import { isZip, requestToTempFile, tempFileResponse } from "@/lib/zip";
import { rateLimit } from "@/lib/security";

export const runtime = "nodejs";

/** Download everything Lofn holds about the participant: a zip with data.json and media (or ?format=json). */
export const GET = route(async (req) => {
  const ctx = await requireParticipant();
  if (new URL(req.url).searchParams.get("format") === "json") {
    return new Response(JSON.stringify(await participantData(ctx), null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="lofn-my-data-${ctx.participant.alias}.json"`, "cache-control": "no-store" },
    });
  }
  return tempFileResponse(await exportParticipantArchive(ctx), `lofn-my-data-${ctx.participant.alias}.zip`);
});

/** Import a previous "my data" export: its contributions are added to the current round. */
export const POST = route(async (req) => {
  const ctx = await requireParticipant();
  if (!rateLimit(`myimport:${ctx.participant.id}`, 5, 10 * 60_000)) throw new ApiError(429, "Too many imports. Wait a few minutes.");
  const up = await requestToTempFile(req, 1024 * 1048576);
  try {
    if (!(await isZip(up.path))) throw new ApiError(400, "Choose the .zip file you downloaded with “Download my data”.");
    return json(await importParticipantArchive(ctx, up.path));
  } finally {
    await fsp.unlink(up.path).catch(() => {});
  }
});

/** Erase all of the participant's contributions in this project, but stay in the group. */
export const DELETE = route(async () => {
  const ctx = await requireParticipant();
  const r = await eraseContributions(ctx.participant.id);
  return json({ ok: true, erased: r.erased });
});
