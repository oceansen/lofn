import { z } from "zod";
import { one } from "@/lib/db";
import { body, json, route, unauthorized, forbidden, ApiError } from "@/lib/http";
import { rateLimit, verifyPassword } from "@/lib/security";
import { createAdminSession } from "@/lib/session";
import { statusError } from "@/lib/accounts";

const Schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export const POST = route(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`login:${ip}`, 10, 60_000)) throw new ApiError(429, "Too many sign-in attempts. Wait a minute and try again.");
  const { email, password } = await body(req, Schema);
  const a = await one(
    `SELECT a.id, a.password_hash, a.status, (SELECT string_agg(provider, ',') FROM admin_identities WHERE admin_id=a.id) AS providers
       FROM admins a WHERE a.email=$1`,
    [email],
  );
  if (a && !a.password_hash && a.providers) {
    const names = String(a.providers).split(",").map((p) => (p === "google" ? "Google" : "GitHub")).join(" or ");
    throw unauthorized(`This account signs in with ${names}. Use that button instead.`);
  }
  if (!a || !a.password_hash || !verifyPassword(password, a.password_hash)) throw unauthorized("Email or password is incorrect.");
  const err = statusError(a);
  if (err) throw forbidden(err);
  await createAdminSession(a.id);
  return json({ ok: true });
});
