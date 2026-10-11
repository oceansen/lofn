import { query } from "@/lib/db";
import { badRequest, json, route } from "@/lib/http";
import { requireAdmin, requireOwned } from "@/lib/session";
import { saveQuestionImage } from "@/lib/question-images";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };

/** Upload (raw body) or replace the reference image: POST /api/admin/questions/:id/image?alt=… */
export const POST = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const q = await requireOwned(admin.id, "questions", (await params).id);
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) throw badRequest("Choose an image to upload.");
  await saveQuestionImage(q.id, buf, new URL(req.url).searchParams.get("alt") || "");
  await publish({ t: "project", projectId: q.project_id });
  return json({ ok: true });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const q = await requireOwned(admin.id, "questions", (await params).id);
  await query(`DELETE FROM question_images WHERE question_id=$1`, [q.id]);
  await publish({ t: "project", projectId: q.project_id });
  return json({ ok: true });
});
