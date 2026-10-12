import { pool, type Queryable } from "./db";

export type LofnEvent = {
  t: "cycle" | "contribution" | "answer" | "project_synthesis" | "project" | "context";
  projectId: string;
  groupId?: string;
  cycleId?: string;
  questionId?: string;
  id?: string;
};

export const EVENT_CHANNEL = "lofn_events";

/** Publish a small invalidation event. Clients re-fetch authorised data in response. */
export async function publish(ev: LofnEvent, db: Queryable = pool) {
  try {
    await db.query(`SELECT pg_notify($1, $2)`, [EVENT_CHANNEL, JSON.stringify(ev)]);
  } catch (e) {
    console.warn("[events] publish failed", e);
  }
}
