import { z } from "zod";
import { one } from "@/lib/db";
import { ApiError, body, json, route } from "@/lib/http";
import { normalizeAccessCode, rateLimit } from "@/lib/security";
import { createParticipantSession } from "@/lib/session";

const Schema = z.object({ code: z.string().max(40), name: z.string().trim().max(60).default("") });

export const POST = route(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`join:${ip}`, 20, 60_000)) throw new ApiError(429, "Too many attempts. Wait a minute and try again.");
  const { code, name } = await body(req, Schema);
  const normalized = normalizeAccessCode(code);
  if (!normalized) throw new ApiError(400, "Group codes have 8 letters and numbers, like K7QM-4XPA.", "invalid_code");
  const g = await one(
    `SELECT g.id, g.name, g.code_active, p.status FROM groups g JOIN projects p ON p.id=g.project_id WHERE g.access_code=$1`,
    [normalized],
  );
  if (!g) throw new ApiError(404, "No group uses that code. Check it with your facilitator.", "unknown_code");
  if (!g.code_active) throw new ApiError(403, "This code has been turned off. Ask your facilitator for a new one.", "inactive_code");
  if (g.status !== "active") throw new ApiError(403, "This project has been archived.", "archived");
  const p = await createParticipantSession(g.id, name);
  return json({ ok: true, group: g.name, alias: p.alias });
});
