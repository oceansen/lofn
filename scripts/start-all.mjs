// Runs migrations, then the web server and the worker in one container.
// Used on hosts where web and worker must share a local disk (e.g. a single Render service with a persistent disk).
import { spawn } from "node:child_process";

const port = process.env.PORT || "3000";
const run = (cmd, args) => spawn(cmd, args, { stdio: "inherit", env: process.env });

const migrate = run("npx", ["tsx", "scripts/migrate.ts"]);
migrate.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const procs = [run("npx", ["next", "start", "-p", port]), run("npx", ["tsx", "worker/index.ts"])];
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    for (const p of procs) p.kill("SIGTERM");
    setTimeout(() => process.exit(code), 10_000).unref();
  };
  // If either process dies, exit so the platform restarts the whole service.
  for (const p of procs) p.on("exit", (c) => stop(c ?? 1));
  process.on("SIGTERM", () => stop(0));
  process.on("SIGINT", () => stop(0));
});
