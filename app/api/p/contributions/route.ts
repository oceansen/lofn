import { z } from "zod";
import { body, json, route, ApiError } from "@/lib/http";
import { requireParticipant } from "@/lib/session";
import { createContribution } from "@/lib/contributions";
import { rateLimit } from "@/lib/security";
import { requireConsent } from "@/lib/consent";

const Schema = z.object({
  questionId: z.string().uuid(),
  text: z.string().max(20000).default(""),
  mediaIds: z.array(z.string().uuid()).max(10).default([]),
});

export const POST = route(async (req) => {
  const ctx = await requireParticipant();
  if (!rateLimit(`contrib:${ctx.participant.id}`, 30, 60_000)) throw new ApiError(429, "You're sending very quickly. Wait a moment and try again.");
  const input = await body(req, Schema);
  await requireConsent(ctx, input.mediaIds.length ? "recordings" : "core");
  const c = await createContribution(ctx, input);
  return json({ contribution: { id: c.id, ref: c.ref_no, status: c.status } }, { status: 201 });
});
