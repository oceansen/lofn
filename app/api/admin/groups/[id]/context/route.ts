import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { requireAdmin, requireOwned } from "@/lib/session";
import { query } from "@/lib/db";
import { composeContext, contextView, refreshContext } from "@/lib/group-context";

type Ctx = { params: Promise<{ id: string }> };

/** The facilitator sees a group's context, and the exact text the synthesis receives. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const g = await requireOwned(admin.id, "groups", (await params).id);
  return json({ ...(await contextView(g.id)), composed: (await composeContext(g.id, true)).text });
});

/** The facilitator can switch a group's context off (or on again). */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const g = await requireOwned(admin.id, "groups", (await params).id);
  const { enabled } = await body(req, z.object({ enabled: z.boolean() }));
  await query(`INSERT INTO group_context(group_id, enabled) VALUES ($1,$2) ON CONFLICT (group_id) DO UPDATE SET enabled=$2, updated_at=now()`, [g.id, enabled]);
  await refreshContext(g.id, g.project_id);
  return json(await contextView(g.id));
});
