// Usage: npm run admin:create -- admin@example.org "Strong password" "Name"
import { pool } from "../lib/db";
import { hashPassword } from "../lib/security";
import { migrate } from "./migrate";

async function main() {
  const [email, password, name = ""] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: npm run admin:create -- <email> <password> [name]');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("Use a password of at least 10 characters.");
    process.exit(1);
  }
  await migrate();
  const r = await pool.query(
    `INSERT INTO admins(email, name, password_hash, role, status) VALUES (lower($1), $2, $3, 'admin', 'active')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role='admin', status='active',
       name = COALESCE(NULLIF(EXCLUDED.name,''), admins.name)
     RETURNING id, email`,
    [email.trim(), name, hashPassword(password)],
  );
  console.log(`Administrator ready: ${r.rows[0].email}`);
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
