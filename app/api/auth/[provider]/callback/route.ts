import { cookies } from "next/headers";
import crypto from "node:crypto";
import { config } from "@/lib/config";
import { finishAuth, isProvider } from "@/lib/oauth";
import { accountFromIdentity, statusError } from "@/lib/accounts";
import { createAdminSession } from "@/lib/session";
import { ApiError } from "@/lib/http";

export const dynamic = "force-dynamic";
// Mutable headers so Next can attach Set-Cookie (Response.redirect() headers are immutable).
const redirect = (url: string, status = 302) => new Response(null, { status, headers: { location: url, "cache-control": "no-store" } });
type Ctx = { params: Promise<{ provider: string }> };

const back = (msg: string) => redirect(`${config.appUrl}/admin/login?error=${encodeURIComponent(msg)}`, 302);

export async function GET(req: Request, { params }: Ctx) {
  const { provider } = await params;
  const sp = new URL(req.url).searchParams;
  const jar = await cookies();
  const raw = jar.get("lofn_oauth")?.value;
  jar.delete({ name: "lofn_oauth", path: "/api/auth" });
  if (!isProvider(provider)) return back("Unknown sign-in method.");
  if (sp.get("error")) return back(sp.get("error") === "access_denied" ? "Sign-in was cancelled." : `Sign-in failed: ${sp.get("error")}`);
  let saved: { p: string; s: string; v: string };
  try {
    saved = JSON.parse(Buffer.from(raw || "", "base64url").toString());
  } catch {
    return back("Your sign-in session expired. Try again.");
  }
  const state = sp.get("state") || "";
  const code = sp.get("code") || "";
  const ok = saved.p === provider && state.length === saved.s.length && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(saved.s));
  if (!ok || !code) return back("Sign-in couldn't be verified. Try again.");
  try {
    const profile = await finishAuth(provider, code, saved.v);
    const acct = await accountFromIdentity({ provider, ...profile });
    const err = statusError(acct);
    if (err) return redirect(`${config.appUrl}/admin/login?notice=${encodeURIComponent(err)}`, 302);
    await createAdminSession(acct.id);
    return redirect(`${config.appUrl}/admin`, 302);
  } catch (e) {
    console.warn(`[auth] ${provider} sign-in failed:`, (e as Error).message);
    return back(e instanceof ApiError ? e.message : `Couldn't sign in with ${provider === "google" ? "Google" : "GitHub"}. Try again.`);
  }
}
