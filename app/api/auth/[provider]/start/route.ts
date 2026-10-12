import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { enabledProviders, isProvider, startAuth } from "@/lib/oauth";

export const dynamic = "force-dynamic";
// Mutable headers so Next can attach Set-Cookie (Response.redirect() headers are immutable).
const redirect = (url: string, status = 302) => new Response(null, { status, headers: { location: url, "cache-control": "no-store" } });
type Ctx = { params: Promise<{ provider: string }> };

/** Redirects to Google/GitHub. The state + PKCE verifier live in a short-lived httpOnly cookie. */
export async function GET(_req: Request, { params }: Ctx) {
  const { provider } = await params;
  if (!isProvider(provider) || !enabledProviders()[provider]) return redirect(`${config.appUrl}/admin/login?error=${encodeURIComponent("That sign-in method isn't set up on this Lofn.")}`, 302);
  const { url, state, verifier } = startAuth(provider);
  (await cookies()).set("lofn_oauth", Buffer.from(JSON.stringify({ p: provider, s: state, v: verifier })).toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.appUrl.startsWith("https"),
    path: "/api/auth",
    maxAge: 600,
  });
  return redirect(url, 302);
}
