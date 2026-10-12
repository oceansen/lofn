import { route } from "@/lib/http";
import { requireParticipant } from "@/lib/session";
import { participantData } from "@/lib/consent";

/** Download everything Lofn holds about the signed-in participant, as JSON. */
export const GET = route(async () => {
  const ctx = await requireParticipant();
  const data = await participantData(ctx);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="lofn-my-data-${ctx.participant.alias}.json"`,
      "cache-control": "no-store",
    },
  });
});
