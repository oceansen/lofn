import { z } from "zod";
import { one } from "@/lib/db";
import crypto from "node:crypto";
import { body, conflict, forbidden, json, route } from "@/lib/http";
import { hashPassword } from "@/lib/security";
import { createAdminSession } from "@/lib/session";

// First-run setup: only works while no administrator exists.
export const GET = route(async () => {
  const n = await one(`SELECT count(*)::int AS n FROM admins`);
  return json({ needsSetup: n.n === 0, needsCode: !!process.env.SETUP_CODE });
});

const Schema = z.object({
  name: z.string().trim().max(100).default(""),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  setupCode: z.string().max(200).default(""),
});

// On public deployments, set SETUP_CODE so only someone who knows it can create the first administrator.
function codeOk(given: string) {
  const want = process.env.SETUP_CODE;
  if (!want) return true;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const POST = route(async (req) => {
  const input = await body(req, Schema);
  if (!codeOk(input.setupCode)) throw forbidden("That setup code is wrong. It's the SETUP_CODE value set on the server.");
  const created = await one(
    `INSERT INTO admins(email, name, password_hash) SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM admins) RETURNING id`,
    [input.email, input.name, hashPassword(input.password)],
  );
  if (!created) throw conflict("An administrator already exists. Sign in instead.");
  await createAdminSession(created.id);
  return json({ ok: true });
});
