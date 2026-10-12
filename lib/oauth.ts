// Google and GitHub sign-in (OAuth 2.0 authorization-code flow with state + PKCE). No third-party auth library.
import crypto from "node:crypto";
import { config } from "./config";

export type Provider = "google" | "github";

const env = (k: string) => process.env[k] || "";

const PROVIDERS = {
  google: {
    clientId: () => env("GOOGLE_CLIENT_ID"),
    clientSecret: () => env("GOOGLE_CLIENT_SECRET"),
    authUrl: () => env("GOOGLE_AUTH_URL") || "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: () => env("GOOGLE_TOKEN_URL") || "https://oauth2.googleapis.com/token",
    userUrl: () => env("GOOGLE_USERINFO_URL") || "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
  },
  github: {
    clientId: () => env("GITHUB_CLIENT_ID"),
    clientSecret: () => env("GITHUB_CLIENT_SECRET"),
    authUrl: () => env("GITHUB_AUTH_URL") || "https://github.com/login/oauth/authorize",
    tokenUrl: () => env("GITHUB_TOKEN_URL") || "https://github.com/login/oauth/access_token",
    userUrl: () => (env("GITHUB_API_URL") || "https://api.github.com").replace(/\/$/, ""),
    scope: "read:user user:email",
  },
} as const;

export function isProvider(p: string): p is Provider {
  return p === "google" || p === "github";
}

export function enabledProviders(): Record<Provider, boolean> {
  return {
    google: !!(PROVIDERS.google.clientId() && PROVIDERS.google.clientSecret()),
    github: !!(PROVIDERS.github.clientId() && PROVIDERS.github.clientSecret()),
  };
}

export const redirectUri = (p: Provider) => `${config.appUrl}/api/auth/${p}/callback`;

const b64url = (b: Buffer) => b.toString("base64url");

export function startAuth(p: Provider) {
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const cfg = PROVIDERS[p];
  const url = new URL(cfg.authUrl());
  url.searchParams.set("client_id", cfg.clientId());
  url.searchParams.set("redirect_uri", redirectUri(p));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (p === "google") url.searchParams.set("prompt", "select_account");
  if (p === "github") url.searchParams.set("allow_signup", "true");
  return { url: url.toString(), state, verifier };
}

export type Profile = { subject: string; email: string; emailVerified: boolean; name: string; avatarUrl: string };

async function getJson(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}: ${(data.error_description || data.error || text).toString().slice(0, 200)}`);
  return data;
}

export async function finishAuth(p: Provider, code: string, verifier: string): Promise<Profile> {
  const cfg = PROVIDERS[p];
  const form = new URLSearchParams({
    client_id: cfg.clientId(),
    client_secret: cfg.clientSecret(),
    code,
    redirect_uri: redirectUri(p),
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const token = await getJson(cfg.tokenUrl(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form,
  });
  if (!token.access_token) throw new Error(`${p === "google" ? "Google" : "GitHub"} didn't return an access token${token.error ? ` (${token.error})` : ""}.`);
  const auth = { authorization: `Bearer ${token.access_token}`, accept: "application/json", "user-agent": "Lofn" };

  if (p === "google") {
    const u = await getJson(cfg.userUrl(), { headers: auth });
    return { subject: String(u.sub), email: String(u.email || ""), emailVerified: u.email_verified === true, name: u.name || "", avatarUrl: u.picture || "" };
  }
  const base = cfg.userUrl();
  const gh = { ...auth, accept: "application/vnd.github+json" };
  const u = await getJson(`${base}/user`, { headers: gh });
  // The profile email may be hidden or unverified; use the primary verified address.
  const emails: { email: string; primary: boolean; verified: boolean }[] = await getJson(`${base}/user/emails`, { headers: gh }).catch(() => []);
  const best = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
  return { subject: String(u.id), email: best?.email || "", emailVerified: !!best, name: u.name || u.login || "", avatarUrl: u.avatar_url || "" };
}
