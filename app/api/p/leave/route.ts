import { json, route } from "@/lib/http";
import { clearParticipantSession } from "@/lib/session";

export const POST = route(async () => {
  await clearParticipantSession();
  return json({ ok: true });
});
