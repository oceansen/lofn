import { json, route } from "@/lib/http";
import { requireAdmin, requireProject, isUuid } from "@/lib/session";
import { contributions } from "@/lib/views";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const sp = new URL(req.url).searchParams;
  const conds = ["c.project_id=$1"];
  const args: unknown[] = [p.id];
  for (const [key, col] of [["cycle", "cycle_id"], ["group", "group_id"], ["question", "question_id"]] as const) {
    const v = sp.get(key);
    if (v && isUuid(v)) {
      args.push(v);
      conds.push(`c.${col}=$${args.length}`);
    }
  }
  return json({ contributions: await contributions(conds.join(" AND "), args) });
});
