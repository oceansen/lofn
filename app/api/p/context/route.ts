import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { requireParticipant } from "@/lib/session";
import { requireConsent } from "@/lib/consent";
import { contextView, updateContext } from "@/lib/group-context";

/** The group's shared context (notes + files) and whether answers use it. */
export const GET = route(async () => {
  const ctx = await requireParticipant();
  await requireConsent(ctx);
  return json(await contextView(ctx.group.id, ctx.participant.id));
});

const Patch = z.object({ enabled: z.boolean().optional(), text: z.string().max(20_000).optional() });

export const PUT = route(async (req) => {
  const ctx = await requireParticipant();
  await requireConsent(ctx);
  await updateContext(ctx, await body(req, Patch));
  return json(await contextView(ctx.group.id, ctx.participant.id));
});
