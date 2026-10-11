import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const badRequest = (m: string) => new ApiError(400, m, "bad_request");
export const unauthorized = (m = "Sign in to continue.") => new ApiError(401, m, "unauthorized");
export const forbidden = (m = "You don't have access to this.") => new ApiError(403, m, "forbidden");
export const notFound = (m = "Not found.") => new ApiError(404, m, "not_found");
export const conflict = (m: string) => new ApiError(409, m, "conflict");

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers || {}) } });
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients; cookies are SameSite=Lax anyway
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw forbidden("Cross-origin request rejected.");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw forbidden("Cross-origin request rejected.");
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

export function route<C = any>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.message, code: e.code }, { status: e.status });
      if (e instanceof ZodError) {
        const first = e.issues[0];
        const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
        return json({ error: `${where}${first?.message ?? "Invalid input"}`, code: "validation" }, { status: 400 });
      }
      console.error("[api]", req.method, req.url, e);
      return json({ error: "Something went wrong on the server. Try again.", code: "server_error" }, { status: 500 });
    }
  };
}

export async function body<T>(req: Request, schema: { parse: (v: unknown) => T }): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be JSON.");
  }
  return schema.parse(raw);
}
