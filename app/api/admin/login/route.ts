import { z } from "zod";
import { one } from "@/lib/db";
import { body, json, route, unauthorized, ApiError } from "@/lib/http";
import { rateLimit, verifyPassword } from "@/lib/security";
import { createAdminSession } from "@/lib/session";

const Schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export const POST = route(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`login:${ip}`, 10, 60_000)) throw new ApiError(429, "Too many sign-in attempts. Wait a minute and try again.");
  const { email, password } = await body(req, Schema);
  const admin = await one(`SELECT id, password_hash FROM admins WHERE email=$1`, [email]);
  if (!admin || !verifyPassword(password, admin.password_hash)) throw unauthorized("Email or password is incorrect.");
  await createAdminSession(admin.id);
  return json({ ok: true });
});
