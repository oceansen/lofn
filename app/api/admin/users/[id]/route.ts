import { z } from "zod";
import { one, query } from "@/lib/db";
import { badRequest, body, json, notFound, route } from "@/lib/http";
import { isUuid, requireInstanceAdmin } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };
const Patch = z.object({ role: z.enum(["admin", "member"]).optional(), status: z.enum(["active", "pending", "disabled"]).optional() });

export const PATCH = route<Ctx>(async (req, { params }) => {
  const me = await requireInstanceAdmin();
  const { id } = await params;
  if (!isUuid(id)) throw notFound();
  const b = await body(req, Patch);
  if (id === me.id && (b.role === "member" || (b.status && b.status !== "active"))) throw badRequest("You can't remove your own administrator access. Ask another administrator.");
  const u = await one(`UPDATE admins SET role=COALESCE($2,role), status=COALESCE($3,status) WHERE id=$1 RETURNING id`, [id, b.role ?? null, b.status ?? null]);
  if (!u) throw notFound();
  // Disabling signs the person out everywhere.
  if (b.status === "disabled") await query(`DELETE FROM admin_sessions WHERE admin_id=$1`, [id]);
  const admins = await one(`SELECT count(*)::int AS n FROM admins WHERE role='admin' AND status='active'`);
  if (admins.n === 0) {
    await query(`UPDATE admins SET role='admin', status='active' WHERE id=$1`, [me.id]);
    throw badRequest("At least one active administrator is required.");
  }
  return json({ ok: true });
});

/** Delete an account and everything it owns (its projects, contributions and media). */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const me = await requireInstanceAdmin();
  const { id } = await params;
  if (!isUuid(id)) throw notFound();
  if (id === me.id) throw badRequest("You can't delete your own account here.");
  const { scheduleStorageDeletion } = await import("@/lib/retention");
  for (const p of await query(`SELECT id FROM projects WHERE owner_id=$1`, [id])) await scheduleStorageDeletion(p.id);
  await query(`DELETE FROM admins WHERE id=$1`, [id]);
  return json({ ok: true });
});
