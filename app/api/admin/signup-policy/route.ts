import { z } from "zod";
import { body, json, route, badRequest } from "@/lib/http";
import { requireInstanceAdmin } from "@/lib/session";
import { getSignupPolicy, saveSignupPolicy } from "@/lib/accounts";

const Schema = z.object({
  mode: z.enum(["open", "approval", "domains", "closed"]),
  domains: z.array(z.string().trim().toLowerCase().regex(/^@?[a-z0-9.-]+\.[a-z]{2,}$/, "Enter domains like sintef.no")).max(50).default([]),
});

export const GET = route(async () => {
  await requireInstanceAdmin();
  return json({ policy: await getSignupPolicy() });
});

export const PUT = route(async (req) => {
  const me = await requireInstanceAdmin();
  const p = await body(req, Schema);
  const domains = [...new Set(p.domains.map((d) => d.replace(/^@/, "")))];
  if (p.mode === "domains" && !domains.length) throw badRequest("Add at least one email domain.");
  await saveSignupPolicy({ mode: p.mode, domains }, me.id);
  return json({ policy: await getSignupPolicy() });
});
