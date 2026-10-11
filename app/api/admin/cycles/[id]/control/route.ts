import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { requireAdmin, requireOwned } from "@/lib/session";
import { controlCycle, cycleView } from "@/lib/cycles";

type Ctx = { params: Promise<{ id: string }> };
const Schema = z.object({
  action: z.enum(["start", "pause", "resume", "extend", "end", "reopen"]),
  minutes: z.number().min(0.5).max(1440).optional(),
});

export const POST = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const c = await requireOwned(admin.id, "cycles", (await params).id);
  const b = await body(req, Schema);
  const updated = await controlCycle(c.id, b);
  return json({ cycle: cycleView(updated) });
});
