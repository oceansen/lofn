import { config } from "@/lib/config";
import { aiStatus } from "@/lib/ai/settings";
import { json, route } from "@/lib/http";
import { requireAdmin } from "@/lib/session";
import { one } from "@/lib/db";

export const GET = route(async () => {
  await requireAdmin();
  const q = await one(
    `SELECT count(*) FILTER (WHERE status='queued' AND run_at <= now())::int AS queued,
            count(*) FILTER (WHERE status='running')::int AS running,
            count(*) FILTER (WHERE status='failed' AND updated_at > now() - interval '1 day')::int AS failed_24h,
            max(updated_at) FILTER (WHERE status='done') AS last_done
       FROM jobs`,
  );
  return json({ ai: await aiStatus(), storage: config.storage.driver, synthesisIntervalSeconds: config.synthesis.intervalMs / 1000, queue: q });
});
