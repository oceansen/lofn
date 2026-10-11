// One-command local run: `npm run local`
// Needs only Node.js. Starts a private PostgreSQL (from npm), builds the app on first run,
// then runs the web app and the worker together. Data lives in ./.lofn-local (delete it to start over).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const dataDir = path.join(root, ".lofn-local");
const PG_PORT = Number(process.env.LOFN_PG_PORT || 54329);
const PORT = Number(process.env.PORT || 3000);

// .env (optional) holds AI keys etc.; real environment variables win.
const env = { ...process.env };
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2].replace(/\s+#.*$/, "");
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (env[m[1]] === undefined && v !== "") env[m[1]] = v;
  }
}
// Local runs always use the embedded database and local media folder.
delete env.DATABASE_URL;
env.DATABASE_URL = `postgres://lofn:lofn@127.0.0.1:${PG_PORT}/lofn`;
env.STORAGE_DRIVER = "local";
env.STORAGE_DIR = path.join(dataDir, "storage");
env.APP_URL = `http://localhost:${PORT}`;
env.NODE_ENV = "production";

function hasCmd(cmd) {
  return spawnSync(cmd, ["-version"], { stdio: "ignore" }).status === 0;
}
// The worker finds ffmpeg itself (system binary first, then the copy bundled via npm).
if (!hasCmd("ffmpeg")) {
  let ok = false;
  try {
    const { default: inst } = await import("@ffmpeg-installer/ffmpeg");
    fs.chmodSync(inst.path, 0o755);
    ok = hasCmd(inst.path);
  } catch {}
  if (!ok) console.warn("  ! ffmpeg isn't available, so video frames won't be analysed.\n    Fix: brew install ffmpeg   (or run npm install again)\n");
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

console.log("\n  Lofn — local test run\n");
if (!(await portFree(PORT))) {
  console.error(`  Port ${PORT} is already in use. Stop the other program or run: PORT=3001 npm run local\n`);
  process.exit(1);
}

// ---- PostgreSQL ----
const { default: EmbeddedPostgres } = await import("embedded-postgres");
fs.mkdirSync(dataDir, { recursive: true });
const pgDir = path.join(dataDir, "pg");
const pg = new EmbeddedPostgres({ databaseDir: pgDir, user: "lofn", password: "lofn", port: PG_PORT, persistent: true, onLog: () => {} });
const fresh = !fs.existsSync(path.join(pgDir, "PG_VERSION"));
if (fresh) {
  console.log("  • Setting up a private database (first run only)…");
  await pg.initialise();
}
fs.rmSync(path.join(pgDir, "postmaster.pid"), { force: true });
await pg.start();
if (fresh) await pg.createDatabase("lofn");
console.log(`  • Database running (data in ${path.relative(root, dataDir)}/)`);

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  await pg.stop().catch(() => {});
  process.exit(code);
}
const procs = [];
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const node = (args, opts = {}) => spawn(process.execPath, args, { stdio: "inherit", env, ...opts });
const waitExit = (p) => new Promise((r) => p.on("exit", (c) => r(c ?? 1)));

// ---- build on first run (or after code changes) ----
const buildId = path.join(root, ".next", "BUILD_ID");
const newest = (dir) => {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
};
const stale = !fs.existsSync(buildId) || ["app", "components", "lib"].some((d) => newest(path.join(root, d)) > fs.statSync(buildId).mtimeMs);
if (stale) {
  console.log("  • Building the app (takes a minute the first time)…\n");
  const code = await waitExit(node(["node_modules/next/dist/bin/next", "build"]));
  if (code !== 0) {
    console.error("\n  Build failed; see the messages above.\n");
    await shutdown(1);
  }
}

// ---- migrate, then run app + worker ----
const mig = await waitExit(node(["--import", "tsx", "scripts/migrate.ts"], { stdio: "ignore" }));
if (mig !== 0) {
  console.error("  Database migration failed.");
  await shutdown(1);
}
procs.push(node(["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { stdio: ["ignore", "ignore", "inherit"] }));
procs.push(node(["--import", "tsx", "worker/index.ts"]));
for (const p of procs) p.on("exit", (c) => !stopping && shutdown(c ?? 1));

// Wait until the app answers, then open the browser.
const url = `http://localhost:${PORT}`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${url}/api/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`
  ✓ Lofn is running at ${url}

    Participants:   ${url}
    Facilitator:    ${url}/admin   (the first visit creates your admin account)
    AI models:      ${url}/admin/ai

  Press Ctrl+C to stop. Your data is kept for next time in .lofn-local/
`);
if (process.platform === "darwin" && !env.NO_OPEN) spawn("open", [`${url}/admin`], { stdio: "ignore" });
