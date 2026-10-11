// Runs migrations, then the web server and the worker in one container.
// Used on hosts where web and worker must share a local disk (a single Render service, a Hugging Face Space).
//
// If DATABASE_URL is not set, an embedded PostgreSQL is started inside the container
// (data under /data when a persistent volume is mounted there, otherwise in $HOME — ephemeral).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = process.env.PORT || "3000";
const env = { ...process.env };
let pgDataDir = null;

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function pgBin(name) {
  for (const v of ["18", "17", "16", "15", "14"]) {
    const p = `/usr/lib/postgresql/${v}/bin/${name}`;
    if (fs.existsSync(p)) return p;
  }
  return name;
}


function sh(cmd, args, opts = {}) {
  const [c, a] = isRoot && opts.asPg ? ["runuser", ["-u", PG_USER, "--", cmd, ...args]] : [cmd, args];
  const r = spawnSync(c, a, { stdio: "inherit", env });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

const isRoot = process.getuid?.() === 0;
// PostgreSQL refuses to run as root; when we are root, run it as the image's unprivileged "node" user.
const PG_USER = process.env.PG_RUN_AS || "node";

// A persistent volume counts only if the platform mounted it (Hugging Face persistent storage mounts /data).
const persistent = fs.existsSync("/data") && writable("/data");
// (/root isn't traversable by the postgres user, so root uses /var/lib/lofn.)
const base = persistent ? "/data" : isRoot ? "/var/lib/lofn" : path.join(os.homedir(), "lofn-data");
if (!env.STORAGE_DIR) env.STORAGE_DIR = path.join(base, "storage");

if (!env.DATABASE_URL) {
  pgDataDir = path.join(base, "pg");
  const fresh = !fs.existsSync(path.join(pgDataDir, "PG_VERSION"));
  fs.mkdirSync(pgDataDir, { recursive: true, mode: 0o700 });
  if (isRoot) spawnSync("chown", ["-R", `${PG_USER}:${PG_USER}`, pgDataDir, base], { stdio: "inherit" });
  if (fresh) sh(pgBin("initdb"), ["-D", pgDataDir, "-U", "lofn", "--auth=trust", "--encoding=UTF8", "-c", "listen_addresses=127.0.0.1"], { asPg: true });
  fs.rmSync(path.join(pgDataDir, "postmaster.pid"), { force: true }); // stale after an unclean stop
  sh(pgBin("pg_ctl"), ["-D", pgDataDir, "-l", path.join(base, "postgres.log"), "-o", "-k /tmp -p 5432 -c listen_addresses=127.0.0.1", "-w", "start"], { asPg: true });
  if (fresh) sh(pgBin("createdb"), ["-h", "127.0.0.1", "-U", "lofn", "lofn"]);
  env.DATABASE_URL = "postgres://lofn@127.0.0.1:5432/lofn";
  console.log(`[start] embedded PostgreSQL running (data in ${pgDataDir}${persistent ? "" : " — EPHEMERAL: lost on restart"})`);
}
console.log(`[start] media storage: ${env.STORAGE_DIR}${persistent || env.STORAGE_DRIVER === "s3" ? "" : " (ephemeral)"}`);

const run = (cmd, args) => spawn(cmd, args, { stdio: "inherit", env });

function stopPostgres() {
  if (!pgDataDir) return;
  const args = ["-D", pgDataDir, "-m", "fast", "stop"];
  if (isRoot) spawnSync("runuser", ["-u", PG_USER, "--", pgBin("pg_ctl"), ...args], { stdio: "inherit" });
  else spawnSync(pgBin("pg_ctl"), args, { stdio: "inherit" });
}

// Run binaries directly (not via npx) so signals reach the real processes.
const NEXT = ["node_modules/next/dist/bin/next", "start", "-p", port];
const migrate = run("node", ["--import", "tsx", "scripts/migrate.ts"]);
migrate.on("exit", (code) => {
  if (code !== 0) {
    stopPostgres();
    process.exit(code ?? 1);
  }
  const procs = [run("node", NEXT), run("node", ["--import", "tsx", "worker/index.ts"])];
  let stopping = false;
  let exitCode = 0;
  let alive = procs.length;
  const finish = () => {
    stopPostgres();
    process.exit(exitCode);
  };
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    for (const p of procs) if (p.exitCode === null) p.kill("SIGTERM");
    setTimeout(() => {
      for (const p of procs) if (p.exitCode === null) p.kill("SIGKILL");
      finish();
    }, 15_000);
  };
  // If either process dies, stop everything so the platform restarts the whole service.
  for (const p of procs)
    p.on("exit", (c) => {
      alive--;
      stop(c ?? 1);
      if (alive === 0) finish();
    });
  process.on("SIGTERM", () => stop(0));
  process.on("SIGINT", () => stop(0));
});
