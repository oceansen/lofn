import { cookies } from "next/headers";
import { one, query } from "./db";
import { config } from "./config";
import { randomToken, sha256 } from "./security";
import { forbidden, notFound, unauthorized } from "./http";

export const ADMIN_COOKIE = "lofn_admin";
export const PARTICIPANT_COOKIE = "lofn_p";
const ADMIN_TTL_DAYS = 14;
const PARTICIPANT_TTL_DAYS = 30;

export type Admin = { id: string; email: string; name: string };

function cookieOpts(days: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.isProd && config.appUrl.startsWith("https"),
    path: "/",
    maxAge: days * 24 * 3600,
  };
}

export async function createAdminSession(adminId: string) {
  const token = randomToken();
  await query(`INSERT INTO admin_sessions(token_hash, admin_id, expires_at) VALUES ($1,$2, now() + ($3 || ' days')::interval)`, [
    sha256(token),
    adminId,
    String(ADMIN_TTL_DAYS),
  ]);
  (await cookies()).set(ADMIN_COOKIE, token, cookieOpts(ADMIN_TTL_DAYS));
}

export async function destroyAdminSession() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) await query(`DELETE FROM admin_sessions WHERE token_hash=$1`, [sha256(token)]);
  jar.delete(ADMIN_COOKIE);
}

export async function getAdmin(): Promise<Admin | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  return one<Admin>(
    `SELECT a.id, a.email, a.name FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash=$1 AND s.expires_at > now()`,
    [sha256(token)],
  );
}

export async function requireAdmin(): Promise<Admin> {
  const a = await getAdmin();
  if (!a) throw unauthorized();
  return a;
}

/** Throws 404 (not 403) for projects the admin doesn't own, so IDs can't be probed. */
export async function requireProject(adminId: string, projectId: string) {
  if (!isUuid(projectId)) throw notFound("Project not found.");
  const p = await one(`SELECT * FROM projects WHERE id=$1 AND owner_id=$2`, [projectId, adminId]);
  if (!p) throw notFound("Project not found.");
  return p;
}

/** Resolve any child resource to its project and check ownership. */
export async function requireOwned(adminId: string, table: "questions" | "groups" | "cycles" | "contributions" | "answers", id: string) {
  if (!isUuid(id)) throw notFound();
  const row = await one(
    `SELECT t.* FROM ${table} t JOIN projects p ON p.id = t.project_id WHERE t.id=$1 AND p.owner_id=$2`,
    [id, adminId],
  );
  if (!row) throw notFound();
  return row;
}

export function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ---------- participants ----------

export type ParticipantCtx = {
  participant: { id: string; alias: string; display_name: string };
  group: { id: string; name: string; project_id: string; code_active: boolean };
  project: { id: string; name: string; description: string; status: string };
};

export async function createParticipantSession(groupId: string, displayName: string) {
  const token = randomToken();
  const row = await one<{ id: string; alias: string }>(
    `WITH c AS (UPDATE groups SET participant_counter = participant_counter + 1 WHERE id=$1 RETURNING participant_counter)
     INSERT INTO participants(group_id, token_hash, alias, display_name)
     SELECT $1, $2, 'P' || c.participant_counter, $3 FROM c RETURNING id, alias`,
    [groupId, sha256(token), displayName],
  );
  (await cookies()).set(PARTICIPANT_COOKIE, token, cookieOpts(PARTICIPANT_TTL_DAYS));
  return row!;
}

export async function clearParticipantSession() {
  (await cookies()).delete(PARTICIPANT_COOKIE);
}

export async function getParticipant(): Promise<ParticipantCtx | null> {
  const token = (await cookies()).get(PARTICIPANT_COOKIE)?.value;
  if (!token) return null;
  const r = await one(
    `UPDATE participants pa SET last_seen_at = now()
       FROM groups g JOIN projects p ON p.id = g.project_id
      WHERE pa.token_hash=$1 AND g.id = pa.group_id
      RETURNING pa.id AS pid, pa.alias, pa.display_name, g.id AS gid, g.name AS gname, g.project_id, g.code_active,
                p.name AS pname, p.description AS pdesc, p.status AS pstatus`,
    [sha256(token)],
  );
  if (!r) return null;
  return {
    participant: { id: r.pid, alias: r.alias, display_name: r.display_name },
    group: { id: r.gid, name: r.gname, project_id: r.project_id, code_active: r.code_active },
    project: { id: r.project_id, name: r.pname, description: r.pdesc, status: r.pstatus },
  };
}

export async function requireParticipant(): Promise<ParticipantCtx> {
  const p = await getParticipant();
  if (!p) throw unauthorized("Enter your group code to join.");
  if (!p.group.code_active) throw forbidden("This group's access code has been turned off by the facilitator.");
  if (p.project.status !== "active") throw forbidden("This project has been archived.");
  return p;
}
