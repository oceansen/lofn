import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { clearParticipantSession, requireParticipant } from "@/lib/session";
import { participantConsent, signConsent, withdrawParticipant } from "@/lib/consent";
import { rateLimit } from "@/lib/security";
import { ApiError } from "@/lib/http";

/** The current consent form and whether this participant has signed it. */
export const GET = route(async () => {
  const ctx = await requireParticipant();
  const { current, signed } = await participantConsent(ctx);
  return json({
    project: { name: ctx.project.name },
    group: { name: ctx.group.name },
    me: { alias: ctx.participant.alias, name: ctx.participant.display_name },
    form: { versionId: current.id, version: current.version, document: current.document },
    signed,
  });
});

const Sign = z.object({
  versionId: z.string().uuid(),
  signedName: z.string().trim().min(2, "Type your full name to sign.").max(120),
  choices: z.object({
    core: z.boolean(),
    age: z.boolean(),
    recordings: z.boolean().default(false),
    health: z.boolean().default(false),
    hipaa: z.boolean().default(false),
  }),
});

export const POST = route(async (req) => {
  const ctx = await requireParticipant();
  if (!rateLimit(`consent:${ctx.participant.id}`, 10, 60_000)) throw new ApiError(429, "Too many attempts. Wait a minute.");
  const b = await body(req, Sign);
  const choices = await signConsent(ctx, b.versionId, b.signedName, b.choices);
  return json({ ok: true, choices }, { status: 201 });
});

/** Decline or withdraw: erase this participant's contributions and leave the group. */
export const DELETE = route(async () => {
  const ctx = await requireParticipant();
  const r = await withdrawParticipant(ctx);
  await clearParticipantSession();
  return json({ ok: true, erased: r.erased });
});
