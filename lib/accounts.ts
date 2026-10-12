// Facilitator accounts: sign-up policy, creation, and linking of Google/GitHub identities.
import { one, query, tx } from "./db";
import { forbidden } from "./http";

export type SignupMode = "open" | "approval" | "domains" | "closed";
export type SignupPolicy = { mode: SignupMode; domains: string[] };
export type Account = { id: string; email: string; name: string; role: "admin" | "member"; status: "active" | "pending" | "disabled"; avatar_url: string };

const DEFAULT_POLICY: SignupPolicy = {
  mode: (["open", "approval", "domains", "closed"].includes(process.env.SIGNUP_MODE || "") ? process.env.SIGNUP_MODE : "open") as SignupMode,
  domains: (process.env.ALLOWED_EMAIL_DOMAINS || "").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean),
};

export async function getSignupPolicy(): Promise<SignupPolicy> {
  const row = await one(`SELECT value FROM app_settings WHERE key='signup'`).catch(() => null);
  return { ...DEFAULT_POLICY, ...(row?.value ?? {}) };
}

export async function saveSignupPolicy(p: SignupPolicy, adminId: string) {
  await query(
    `INSERT INTO app_settings(key, value, updated_by) VALUES ('signup', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [JSON.stringify(p), adminId],
  );
}

export async function accountCount(): Promise<number> {
  return (await one(`SELECT count(*)::int AS n FROM admins`)).n;
}

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/**
 * Decide the status of a new account. The very first account always becomes an active instance admin.
 * `verified` = the email was verified by Google/GitHub (password sign-ups can't prove ownership).
 */
export async function signupDecision(email: string, verified: boolean): Promise<{ role: "admin" | "member"; status: "active" | "pending" }> {
  if ((await accountCount()) === 0) return { role: "admin", status: "active" };
  const p = await getSignupPolicy();
  switch (p.mode) {
    case "closed":
      throw forbidden("New accounts are closed on this Lofn. Ask its administrator for access.");
    case "open":
      return { role: "member", status: "active" };
    case "approval":
      return { role: "member", status: "pending" };
    case "domains": {
      const allowed = p.domains.includes(domainOf(email));
      if (!allowed) throw forbidden(`Accounts are limited to ${p.domains.map((d) => "@" + d).join(", ") || "approved domains"} on this Lofn.`);
      // A password sign-up can't prove the address is real, so it waits for approval.
      return { role: "member", status: verified ? "active" : "pending" };
    }
  }
}

export async function createAccount(input: { email: string; name: string; passwordHash: string | null; verified: boolean; avatarUrl?: string }) {
  const d = await signupDecision(input.email, input.verified);
  return one<Account>(
    `INSERT INTO admins(email, name, password_hash, role, status, avatar_url) VALUES (lower($1), $2, $3, $4, $5, $6)
     RETURNING id, email, name, role, status, avatar_url`,
    [input.email, input.name, input.passwordHash, d.role, d.status, input.avatarUrl ?? ""],
  ) as Promise<Account>;
}

/** Sign in (or sign up) with a provider identity. Links to an existing account with the same verified email. */
export async function accountFromIdentity(p: {
  provider: "google" | "github";
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string;
}): Promise<Account> {
  const linked = await one<Account>(
    `SELECT a.id, a.email, a.name, a.role, a.status, a.avatar_url FROM admin_identities i JOIN admins a ON a.id=i.admin_id
      WHERE i.provider=$1 AND i.subject=$2`,
    [p.provider, p.subject],
  );
  if (linked) return linked;
  if (!p.email || !p.emailVerified) throw forbidden(`Your ${p.provider === "google" ? "Google" : "GitHub"} account has no verified email address, so Lofn can't sign you in with it.`);
  return tx(async (db) => {
    let acct = await one<Account>(`SELECT id, email, name, role, status, avatar_url FROM admins WHERE email=lower($1)`, [p.email], db);
    if (!acct) {
      const d = await signupDecision(p.email, true);
      acct = await one<Account>(
        `INSERT INTO admins(email, name, password_hash, role, status, avatar_url) VALUES (lower($1),$2,NULL,$3,$4,$5)
         RETURNING id, email, name, role, status, avatar_url`,
        [p.email, p.name, d.role, d.status, p.avatarUrl],
        db,
      );
    }
    await db.query(`INSERT INTO admin_identities(provider, subject, admin_id, email) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [
      p.provider, p.subject, acct!.id, p.email,
    ]);
    if (!acct!.avatar_url && p.avatarUrl) await db.query(`UPDATE admins SET avatar_url=$2 WHERE id=$1`, [acct!.id, p.avatarUrl]);
    return acct!;
  });
}

export function statusError(a: Pick<Account, "status">) {
  if (a.status === "pending") return "Your account is waiting for approval by this Lofn's administrator.";
  if (a.status === "disabled") return "This account has been disabled. Contact this Lofn's administrator.";
  return null;
}
