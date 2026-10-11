import { sseResponse } from "@/lib/event-bus";
import { requireParticipant } from "@/lib/session";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Only this group's events (plus project-wide cycle/project changes) are forwarded. */
export const GET = route(async (req) => {
  const ctx = await requireParticipant();
  return sseResponse(
    req,
    (ev) => ev.projectId === ctx.project.id && (ev.t === "cycle" || ev.t === "project" || ev.groupId === ctx.group.id),
  );
});
