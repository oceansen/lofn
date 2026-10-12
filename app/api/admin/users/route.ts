import { query } from "@/lib/db";
import { json, route } from "@/lib/http";
import { requireInstanceAdmin } from "@/lib/session";
import { getSignupPolicy } from "@/lib/accounts";
import { enabledProviders, redirectUri } from "@/lib/oauth";

export const GET = route(async () => {
  const me = await requireInstanceAdmin();
  const users = await query(
    `SELECT a.id, a.email, a.name, a.role, a.status, a.avatar_url, a.created_at, a.last_login_at, a.password_hash IS NOT NULL AS has_password,
            COALESCE((SELECT array_agg(provider) FROM admin_identities WHERE admin_id=a.id), '{}') AS providers,
            (SELECT count(*)::int FROM projects p WHERE p.owner_id=a.id) AS projects
       FROM admins a ORDER BY (a.status='pending') DESC, a.created_at`,
  );
  return json({
    me: me.id,
    users: users.map((u) => ({
      id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, avatarUrl: u.avatar_url, createdAt: u.created_at,
      lastLoginAt: u.last_login_at, hasPassword: u.has_password, providers: u.providers, projects: u.projects,
    })),
    policy: await getSignupPolicy(),
    providers: enabledProviders(),
    callbackUrls: { google: redirectUri("google"), github: redirectUri("github") },
  });
});
