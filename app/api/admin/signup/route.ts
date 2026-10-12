import crypto from "node:crypto";
import { z } from "zod";
import { one } from "@/lib/db";
import { ApiError, body, conflict, forbidden, json, route } from "@/lib/http";
import { hashPassword, rateLimit } from "@/lib/security";
import { createAdminSession } from "@/lib/session";
import { accountCount, createAccount } from "@/lib/accounts";

const Schema = z.object({
  name: z.string().trim().max(100).default(""),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  setupCode: z.string().max(200).default(""),
});

/** SETUP_CODE (optional) protects the very first account on public deployments. */
function setupCodeOk(given: string) {
  const want = process.env.SETUP_CODE;
  if (!want) return true;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const POST = route(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`signup:${ip}`, 8, 10 * 60_000)) throw new ApiError(429, "Too many sign-up attempts. Try again in a few minutes.");
  const input = await body(req, Schema);
  if ((await accountCount()) === 0 && !setupCodeOk(input.setupCode)) throw forbidden("That setup code is wrong. It's the SETUP_CODE value set on the server.");
  if (await one(`SELECT 1 FROM admins WHERE email=$1`, [input.email])) throw conflict("An account with this email already exists. Sign in instead.");
  const acct = await createAccount({ email: input.email, name: input.name, passwordHash: hashPassword(input.password), verified: false });
  if (acct.status !== "active") return json({ ok: true, status: acct.status }, { status: 202 });
  await createAdminSession(acct.id);
  return json({ ok: true, status: acct.status }, { status: 201 });
});
