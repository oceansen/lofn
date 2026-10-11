import fs from "node:fs";
import path from "node:path";
import { pool } from "../lib/db";

export async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await pool.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialise concurrent migrators (app + worker starting together).
      await client.query("SELECT pg_advisory_xact_lock(4242001)");
      const again = await client.query(`SELECT 1 FROM schema_migrations WHERE name=$1`, [f]);
      if (again.rowCount === 0) {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [f]);
        console.log(`[migrate] applied ${f}`);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  migrate()
    .then(() => {
      console.log("[migrate] database is up to date");
      return pool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
